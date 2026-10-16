# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/` + `src/cli.ts` · **Last verified:** 2026-10-16

## Purpose

Process wiring and the `paperplane` CLI. `startDaemon` connects every other module (store, Telegram session, sync loop, actions, MCP HTTP server); the CLI offers `login`, `start`, `token` and `logout`.

## Structure

| File | Purpose |
|---|---|
| `daemon/daemon.ts` | `startDaemon`: builds repos, session, sync loop, `ActionDeps`, MCP HTTP server and signal handlers |
| `daemon/lock.ts` | PID lock file shared by daemon, `login` and `logout` |
| `daemon/loop.ts` | Fixed-interval runner that skips ticks while a run is in flight |
| `daemon/logger.ts` | pino logger with redaction as a safety net |
| `daemon/token.ts` | Creates/reuses the bearer token in the secret store |
| `daemon/snippets.ts` | Claude Code / Claude Desktop connection text for `paperplane token` |
| `cli.ts` | `paperplane` entry point (`login`, `start`, `token`, `logout`) |
| `*.test.ts` | Unit tests (temp dirs and `MemorySecretStore`; never the real Keychain) |

## Public surface

- CLI: `paperplane login | start | token | logout` (`src/cli.ts:88`)
- `startDaemon()` — `src/daemon/daemon.ts:30`
- `acquireLock(path, pid?)` — `src/daemon/lock.ts:18`
- `startNonOverlappingLoop(task, intervalMs, onError)` — `src/daemon/loop.ts:4`
- `createLogger()` — `src/daemon/logger.ts:7`
- `ensureBearerToken(secrets)` — `src/daemon/token.ts:6`
- `connectionSnippets(port, token)` — `src/daemon/snippets.ts:1`

## Dependencies

Consumes config, secrets, store, sync, telegram, actions and mcp modules; `pino`; `node:readline` (CLI prompts only).

## Gotchas & invariants

- The lock is shared by the daemon, `login` and `logout` (`src/daemon/daemon.ts:36`, `src/cli.ts:38`, `src/cli.ts:71`): two processes on one Telegram session cause AUTH_KEY_DUPLICATED. A lock left by a crashed process is taken over when its PID is dead.
- The daemon never prompts. When not logged in, or when the session is revoked, it stays up with `auth: auth_required` so `status` keeps working (`src/daemon/daemon.ts:76`, `src/daemon/daemon.ts:86`).
- Re-login needs `pm2 restart paperplane`; the running daemon does not pick up a new session.
- The first sweep runs in the background (`src/daemon/daemon.ts:95`): with thousands of dialogs it takes minutes, and it seeds mtcute's peer cache.
- Clean shutdown matters (`src/daemon/daemon.ts:135`): an unclean mtcute storage close makes catchUp replay duplicates. pm2's `kill_timeout` must allow for it.
- The bearer token is hex (`randomBytes(32)`), because `Keychain.set` passes it through `security -i` where a leading `-` from base64url could be mis-parsed.
- Never log message text or secrets; the CLI prints the token only in `paperplane token`.

## Testing

`pnpm test src/daemon`. `startDaemon` and the CLI are verified by typecheck, build and the `PAPERPLANE_HOME=<temp> node dist/cli.js start` smoke check (expects `VALIDATION: apiId missing`); they are never run against the real network or Keychain.
