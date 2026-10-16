# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/` + `src/cli.ts` · **Last verified:** 2026-10-16

## Purpose

Process wiring and the `paperplane` CLI. `startDaemon` connects every other module (store, Telegram session, sync loop, actions, MCP HTTP server); the CLI offers `login`, `start`, `token` and `logout`.

## Structure

| File | Purpose |
|---|---|
| `daemon/daemon.ts` | `startDaemon`: builds repos, session, sync loop, `ActionDeps`, MCP HTTP server and signal handlers |
| `daemon/auth-mode.ts` | `decideAuthMode`: pure decision (credentials present? connect result?) for connect vs `auth_required` |
| `daemon/unauthenticated-gateway.ts` | `TelegramGateway` whose every method throws `AUTH_REQUIRED`; used when there is no usable session |
| `daemon/lock.ts` | PID lock file shared by daemon, `login` and `logout` |
| `daemon/loop.ts` | Fixed-interval runner that skips ticks while a run is in flight |
| `daemon/logger.ts` | pino logger with redaction as a safety net |
| `daemon/token.ts` | Creates/reuses the bearer token in the secret store |
| `daemon/snippets.ts` | Claude Code / Claude Desktop connection text for `paperplane token` |
| `cli.ts` | `paperplane` entry point (`login`, `start`, `token`, `logout`) |
| `*.test.ts` | Unit tests (temp dirs and `MemorySecretStore`; never the real Keychain) |

## Public surface

- CLI: `paperplane login | start | token | logout` (`src/cli.ts:89`)
- `startDaemon(secrets?)` — `src/daemon/daemon.ts:45` (`secrets` defaults to the Keychain; injectable so smoke tests never touch it)
- `decideAuthMode(input)` — `src/daemon/auth-mode.ts:7`
- `createUnauthenticatedGateway()` — `src/daemon/unauthenticated-gateway.ts:13`
- `acquireLock(path, pid?)` — `src/daemon/lock.ts:18` (an empty/garbage lock file is stale, not held)
- `startNonOverlappingLoop(task, intervalMs, onError, { immediate? })` — `src/daemon/loop.ts:5`
- `createLogger()` — `src/daemon/logger.ts:7`
- `ensureBearerToken(secrets)` — `src/daemon/token.ts:6`
- `connectionSnippets(port, token)` — `src/daemon/snippets.ts:1`

## Dependencies

Consumes config, secrets, store, sync, telegram, actions and mcp modules; `pino`; `node:readline` (CLI prompts only).

## Gotchas & invariants

- The lock is shared by the daemon, `login` and `logout` (`src/daemon/daemon.ts:36`, `src/cli.ts:38`, `src/cli.ts:71`): two processes on one Telegram session cause AUTH_KEY_DUPLICATED. A lock left by a crashed process is taken over when its PID is dead.
- The daemon never prompts and never exits for lack of credentials (pm2 would crash-loop). With no apiId, no api_hash, or `session.connect()` returning `auth_required`, it stays up in `auth_required`: it opens the DB, serves HTTP (so `status` and local reads work), uses the unauthenticated gateway for tool deps and does not start the sweep loop (`src/daemon/daemon.ts:105-135`). A revoked session found mid-sweep stops syncing the same way (`src/daemon/daemon.ts:141`).
- Re-login needs `pm2 restart paperplane`; the running daemon does not pick up a new session.
- The first sweep runs in the background through the loop's `immediate` option (`src/daemon/daemon.ts:156`), so it shares the in-flight guard and cannot overlap the next tick; it takes minutes with thousands of dialogs and seeds mtcute's peer cache.
- Signal handlers are registered before startup and every resource is optional, so cleanup is safe after a partial startup; shutdown always releases the lock and exits, with an 8 s hard-exit fallback under pm2's 10 s `kill_timeout` (`src/daemon/daemon.ts:62-77`). A clean mtcute close matters: an unclean storage close makes catchUp replay duplicates.
- The bearer token is hex (`randomBytes(32)`), because `Keychain.set` passes it through `security -i` where a leading `-` from base64url could be mis-parsed.
- Never log message text or secrets; the CLI prints the token only in `paperplane token`.

## Testing

`pnpm test src/daemon`. `startDaemon` and the CLI are verified by typecheck, build and the a smoke run with a temp `PAPERPLANE_HOME` and an in-memory secret store (no apiId: stays up, `/mcp` answers 401, SIGTERM exits 0 and removes the lock). `paperplane start` itself writes the bearer token to the real Keychain, so it is never run in checks; nothing touches the real network.
