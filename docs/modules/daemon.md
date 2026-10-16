# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/` + `src/cli.ts` · **Last verified:** 2026-10-16

## Purpose

Process wiring and the `paperplane` CLI. `startDaemon` connects every other module (store, MCP HTTP server, actions, then the Telegram session and sync loop in the background); the CLI offers `login`, `start`, `token` and `logout`.

## Structure

| File | Purpose |
|---|---|
| `daemon/daemon.ts` | `startDaemon`: builds repos, `ActionDeps`, MCP HTTP server and signal handlers, then connects Telegram in the background |
| `daemon/connector.ts` | `startConnector`: background connect state machine (ok / auth_required / error with capped backoff, cancel on stop) |
| `daemon/switchable-gateway.ts` | `createSwitchableGateway`: one `TelegramGateway` handed to every consumer, whose target is swapped once connected |
| `daemon/auth-mode.ts` | `decideAuthMode`: pure decision (credentials present? connect result?) for connect vs `auth_required` |
| `daemon/unauthenticated-gateway.ts` | `TelegramGateway` whose every method throws `AUTH_REQUIRED`; used while connecting (`NOT_CONNECTED`) and when there is no usable session (`NOT_LOGGED_IN`) |
| `daemon/lock.ts` | PID lock file shared by daemon, `login` and `logout` |
| `daemon/loop.ts` | Fixed-interval runner that skips ticks while a run is in flight |
| `daemon/logger.ts` | pino logger with redaction as a safety net |
| `daemon/token.ts` | Creates/reuses the bearer token in the secret store |
| `daemon/login-input.ts` | Pure prompt text and parsing for `paperplane login` (Enter keeps the stored apiId / api_hash) |
| `daemon/snippets.ts` | Claude Code / Claude Desktop connection text for `paperplane token` |
| `cli.ts` | `paperplane` entry point (`login`, `start`, `token`, `logout`) |
| `*.test.ts` | Unit tests (temp dirs and `MemorySecretStore`; never the real Keychain) |

## Public surface

- CLI: `paperplane login | start | token | logout` (`src/cli.ts:95`)
- `startDaemon(secrets?)` — `src/daemon/daemon.ts:56` (`secrets` defaults to the Keychain; injectable so smoke tests never touch it)
- `decideAuthMode(input)` — `src/daemon/auth-mode.ts:7`
- `startConnector({ attempt, onResult, onError, timers, initialDelayMs?, maxDelayMs? })` — `src/daemon/connector.ts:25` (backoff `CONNECT_RETRY_INITIAL_MS` 5 s doubling to `CONNECT_RETRY_MAX_MS` 60 s, `:19-20`)
- `createSwitchableGateway(initial)` — `src/daemon/switchable-gateway.ts:7`
- `createUnauthenticatedGateway(message = NOT_LOGGED_IN)` — `src/daemon/unauthenticated-gateway.ts:14` (`NOT_LOGGED_IN` / `NOT_CONNECTED` at `:4-5`)
- `acquireLock(path, pid?)` — `src/daemon/lock.ts:18` (an empty/garbage lock file is stale, not held)
- `startNonOverlappingLoop(task, intervalMs, onError, { immediate? })` — `src/daemon/loop.ts:5`
- `createLogger()` — `src/daemon/logger.ts:7`
- `ensureBearerToken(secrets)` — `src/daemon/token.ts:6`
- `apiIdPrompt` / `apiHashPrompt` / `pickApiId` / `pickApiHash` — `src/daemon/login-input.ts:6`, `:11`, `:15`, `:22`
- `connectionSnippets(port, token)` — `src/daemon/snippets.ts:1`

## Dependencies

Consumes config, secrets, store, sync, telegram, actions and mcp modules; `pino`; `node:readline` (CLI prompts only).

## Gotchas & invariants

- The lock is shared by the daemon, `login` and `logout` (`src/daemon/daemon.ts:61`, `src/cli.ts:39`, `src/cli.ts:78`): two processes on one Telegram session cause AUTH_KEY_DUPLICATED. A lock left by a crashed process is taken over when its PID is dead.
- HTTP and the DB come up before Telegram (`src/daemon/daemon.ts:175`): tools never wait on Telegram for reads, and offline mtcute retries a connect forever. `status.auth` is `'connecting'` while the background connect runs (`:128`).
- Every consumer (`ActionDeps`, `BackfillDeps`, the sweep) gets one switchable gateway (`src/daemon/daemon.ts:131`). Until connected it serves the unauthenticated gateway with `NOT_CONNECTED` (`AUTH_REQUIRED: Telegram not connected yet`; the existing code is reused because the caller's remedy is the same kind of thing). Connect `'ok'` swaps in the real gateway and starts the sweep loop with `immediate: true`; `'auth_required'` swaps to the `NOT_LOGGED_IN` gateway and starts no loop (`:213-229`). Nothing ever calls into an unauthorized mtcute client.
- A non-auth connect error never exits the process: it is logged with `describeError` and retried by `startConnector` with 5 s doubling to 60 s backoff (`src/daemon/daemon.ts:202-232`). Each attempt destroys the previous attempt's client first so only one client holds the session; shutdown sets `res.closed`, stops the connector (cancels a pending retry, ignores a late result) and destroys the current session (`:66-73`).
- The daemon never prompts and never exits for lack of credentials (pm2 would crash-loop). With no apiId or no api_hash it stays up in `auth_required` and never starts a connect. A session revoked mid-run (from the phone) only stops the sync loop: the sweep marks `auth_required` and returns (`src/daemon/daemon.ts:141-145`), but tools keep the real gateway, so their Telegram calls fail and map to `AUTH_REQUIRED` (`src/telegram/errors.ts:25`).
- Re-login: `pm2 stop paperplane && paperplane login && pm2 start paperplane`. `login` takes the same lock as the daemon, so it cannot run while the daemon is up, and the running daemon would not pick up a new session anyway. Every hint (daemon log, `NOT_LOGGED_IN`, README) uses this exact command.
- The first sweep runs in the background through the loop's `immediate` option (`src/daemon/daemon.ts:226-228`), so it shares the in-flight guard and cannot overlap the next tick; it takes minutes with thousands of dialogs and seeds mtcute's peer cache.
- `process.on('unhandledRejection')` is a log-only safety net (`src/daemon/daemon.ts:91`): `describeError` only, never secrets.
- Signal handlers are registered before startup and every resource is optional, so cleanup is safe after a partial startup; shutdown always releases the lock and exits, with an 8 s hard-exit fallback under pm2's 10 s `kill_timeout` (`src/daemon/daemon.ts:66-93`; `HARD_EXIT_MS` at `:36`). A clean mtcute close matters: an unclean storage close makes catchUp replay duplicates.
- The bearer token is 64 hex chars (`randomBytes(32)`, `src/daemon/token.ts:9`), because `Keychain.set` passes it through `security -i` where a leading `-` from base64url could be mis-parsed.
- `paperplane login` always re-prompts for `api_id` (stored value shown as the default) and `api_hash` (hidden; "press Enter to keep current"), and rejects an empty `api_hash` when none is stored. It saves `apiId` to config and `api_hash` to the Keychain only after `login()` succeeds (`src/cli.ts:59-60`), so a failed login leaves no bad credentials for the daemon to retry with.
- Never log message text or secrets; the CLI prints the token only in `paperplane token`.

## Testing

`pnpm test src/daemon`. `connector.test.ts` drives the connect state machine with a manual timer queue: ok, auth_required, error-then-ok with the 5/10/20/40/60 s backoff, and stop cancelling a pending retry or ignoring a late result. `switchable-gateway.test.ts` checks delegation and the swap. `login-input.test.ts` covers the Enter-keeps-stored rules and validation of the login prompts. `startDaemon` and the CLI are verified by typecheck, build and a smoke run with a temp `PAPERPLANE_HOME` and an in-memory secret store (no apiId: stays up, `/mcp` answers 401, SIGTERM exits 0 and removes the lock). `paperplane start` itself writes the bearer token to the real Keychain, so it is never run in checks; nothing touches the real network.
