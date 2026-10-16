# Module Documentation Index

Living docs, one per module. **Read the relevant doc before modifying a module; update it in the same change.** See the "Module Documentation Convention" section in `CLAUDE.md` for the workflow.

| Doc | Module | One-liner |
|---|---|---|
| [telegram.md](telegram.md) | `src/telegram/` | MTProto user client (mtcute), Keychain auth keys and the `TelegramGateway` adapter. |
| [sync.md](sync.md) | `src/sync/` | Keeps the local store mirroring Telegram: applies live updates (new/edit/delete/read), runs the periodic safety sweep, and does history backfill. |
| [store.md](store.md) | `src/store/` | Paperplane's own SQLite database at `~/.paperplane/paperplane.db` (better-sqlite3, WAL, FTS5): chats, messages, labels, sync cursors, cleanup plans and the audit log. |
| [domain.md](domain.md) | `src/domain/` | Pure logic with no I/O: pending status, label precedence/reset rules, cleanup selection criteria and rate limiting. |
| [actions.md](actions.md) | `src/actions/` | Side effects on Telegram on behalf of MCP tools: messaging, organizing (folders/archive/mute) and destructive operations (delete/leave/block/cleanup). |
| [mcp.md](mcp.md) | `src/mcp/` | The MCP server Claude talks to: Streamable HTTP on `127.0.0.1`, bearer-token auth and the tool definitions. |
| [secrets.md](secrets.md) | `src/secrets/` | macOS Keychain access through the built-in `security` CLI: api_hash, bearer token and the Telegram auth keys. |
| [config.md](config.md) | `src/config/` | `~/.paperplane` path layout and zod-validated config. |
