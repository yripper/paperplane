# Paperplane

Paperplane is a local daemon I run on my Mac. It signs in to my personal Telegram account as a regular user client (MTProto, via [mtcute](https://mtcute.dev)), mirrors my chats into a SQLite database on disk, and serves an MCP server on `127.0.0.1` so Claude Code and Claude Desktop can read, track, answer and organize my conversations. Nothing is hosted: it is one process on my machine, talking only to Telegram.

> **Status:** early development. Module docs live in [docs/modules](docs/modules/README.md).

## Requirements

- macOS (secrets are stored in the Keychain through the built-in `security` CLI)
- Node >= 22 and [pnpm](https://pnpm.io)
- [pm2](https://pm2.keymetrics.io) (`npm i -g pm2`) to keep the daemon running
- Your own `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org)

## Install and log in

```sh
pnpm install && pnpm build
node dist/cli.js login
```

`login` asks for your `api_id`, `api_hash`, phone number, the code Telegram sends you and, if you use one, your 2FA password. The `api_id` and `api_hash` are saved only after Telegram accepts the login; on later logins pressing Enter keeps the stored ones. The `api_hash` and the session keys go to the Keychain; nothing secret is written to disk in plain text. Use `pnpm link --global` if you want a `paperplane` command instead of `node dist/cli.js`.

## Run it

```sh
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints, once, so the daemon starts at login
pm2 logs paperplane
```

The log line `listening on http://127.0.0.1:7777/mcp (telegram auth: connecting)` means the MCP server is up; `telegram connected` follows once Telegram answers. The server never waits for Telegram, so `status` and local reads work while it connects. If you are not logged in yet, the daemon still starts and reports `auth_required` instead of crash-looping (see Troubleshooting).

## Connect Claude

`paperplane token` prints a ready-to-paste snippet for each client:

- **Claude Code:** a `claude mcp add --transport http ...` line with the bearer token.
- **Claude Desktop:** a `mcpServers` entry that goes through `npx mcp-remote`. Desktop's Connectors run in Anthropic's cloud and cannot reach `localhost`, so a local stdio bridge is needed.

The bearer token is 64 hex characters, generated on first use and kept in the Keychain. The server only accepts requests whose `Host` is `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding from a browser.

## Permissions (important)

Allowlist only the read and local-only tools. Everything else (sending, deleting, leaving, blocking, cleanup, folders, archive, mute) should prompt every time. In `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__paperplane__status", "mcp__paperplane__list_chats", "mcp__paperplane__get_pending",
      "mcp__paperplane__read_history", "mcp__paperplane__search_messages", "mcp__paperplane__get_chat_info",
      "mcp__paperplane__set_label", "mcp__paperplane__clear_label", "mcp__paperplane__set_watch_level",
      "mcp__paperplane__list_folders", "mcp__paperplane__cleanup_plan"
    ]
  }
}
```

`cleanup_plan` is safe to allow because it only stores a draft; `cleanup_apply` is the step that acts, and it stays on the prompt list. Tool annotations are hints, so this allowlist is the real safety boundary.

## Tools

25 tools, grouped as in [docs/modules/mcp.md](docs/modules/mcp.md):

- **Read:** `status`, `list_chats`, `get_pending`, `read_history`, `search_messages`, `get_chat_info`
- **Tracking (local only):** `set_label`, `clear_label`, `set_watch_level`
- **Messaging:** `send_message`, `save_draft`, `mark_read`
- **Organize:** `list_folders`, `create_folder`, `edit_folder`, `delete_folder`, `archive_chats`, `unarchive_chats`, `mute_chat`, `unmute_chat`
- **Destructive:** `delete_chat`, `leave_chat`, `block_user`, `cleanup_plan`, `cleanup_apply`

Notes on behavior:

- `get_pending` lists chats waiting on my reply: DMs, plus groups I put on `full` watch (`set_watch_level`). Other groups, channels and bots never count. A reply from my phone clears it within seconds, and reading a chat on my phone moves it to `seen`.
- `delete_chat` with `revoke` (delete for everyone) needs `confirm_title` to match the chat title exactly. It refuses channels and supergroups; `leave_chat` refuses private chats.
- Cleanup is two steps. `cleanup_plan` needs at least one narrowing criterion and lists matches without changing anything. A plan holds at most 20 chats and reports how many matched in total, so bigger cleanups run as several plans. In remove mode `cleanup_apply` waits about a second between chats. `cleanup_apply` re-checks every chat before acting, so a chat that disappeared comes back as `NOT_FOUND` and one promoted to full watch since planning as `FORBIDDEN`. Plans expire after 30 minutes and apply once.
- The sweep that backstops live updates pages large gaps (up to 10 pages per chat) and skips purging chats that were touched while it ran. If a pass sees no dialogs at all, or would remove more than max(5, 25%) of the stored chats, it skips the purge (a glitch is likelier than real deletions) and flags it in `status`.
- Rate limits reject instead of sleeping: 20 sends per minute, 1 s between sends to the same chat, 30 destructive actions per minute. Over the limit you get `RATE_LIMITED` with a retry time.

## Data and privacy

- Everything lives in `~/.paperplane/` (config, message store, mtcute's peer cache, lock file). Back that folder up if you care about the labels and local history.
- Secrets live in the macOS Keychain under the service `paperplane`: `api_hash`, the bearer token and the Telegram auth keys.
- Nothing leaves the machine except Telegram API traffic. Message text is never written to logs or to the audit table.
- Read Telegram's [API Terms of Service](https://core.telegram.org/api/terms) before using this. Section 1.5 restricts using Telegram data with AI systems, and you should judge for yourself whether your use fits.
- Account safety: unofficial clients are watched by Telegram. Use your own `api_id`, keep the volume of actions human, and do not use it to spam.

## Troubleshooting

- **`status` shows `auth_required`:** there is no valid session (never logged in, logged out, or revoked from Telegram's Devices list). The daemon stays up, local reads and `status` still answer, and Telegram tools return `AUTH_REQUIRED`. Run `pm2 stop paperplane && paperplane login && pm2 start paperplane`: `login` takes the same lock as the daemon, so it can't run while the daemon is up.
- **`status` stays `connecting`:** Telegram isn't reachable yet (offline, DNS, Telegram trouble). Local reads still work and Telegram tools return `AUTH_REQUIRED: Telegram not connected yet`. `pm2 logs paperplane` shows `telegram connect failed ... retrying in Ns`; the daemon retries on its own, backing off up to a minute.
- **"already running":** `login` and `logout` share a lock with the daemon, because two processes on one session break it. Run `pm2 stop paperplane` first, then start it again afterwards.
- **Port in use:** set `port` in `~/.paperplane/config.json` (1024-65535, default 7777), then `pm2 restart paperplane` and re-run `paperplane token` for the new URL.

## License

MIT
