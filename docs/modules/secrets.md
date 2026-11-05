# Secrets Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/secrets/` · **Last verified:** 2026-11-06 (Linux `secret-tool` backend)

## Purpose

OS secret storage for the api_hash, bearer token and Telegram auth keys: macOS Keychain through the built-in `security` CLI, Linux Secret Service (GNOME Keyring) through libsecret's `secret-tool`. Callers get one `SecretStore` from `createSecretStore()` and never see which backend it is.

## Structure

| File | Purpose |
|---|---|
| `src/secrets/keychain.ts` | `SecretStore` interface, `SECRET_ACCOUNTS`, shared `assertSafeSecret`, macOS `Keychain` + `securityCli` runner |
| `src/secrets/secret-tool.ts` | Linux `SecretTool` store + `secretToolCli` runner |
| `src/secrets/platform.ts` | `createSecretStore(platform)`: picks the backend |
| `src/secrets/runner.ts` | `CommandRunner` interface and `cliRunner(binary, missingHint)` (spawn wrapper) |
| `src/secrets/keychain.test.ts` | Keychain unit tests with a fake runner, plus an opt-in real-Keychain round trip |
| `src/secrets/secret-tool.test.ts` | SecretTool unit tests with a fake runner, plus an opt-in real `secret-tool` round trip |
| `src/secrets/platform.test.ts` | Backend selection and `cliRunner` (missing binary, stdin/stdout/exit code) |
| `src/testing/memory-secrets.ts` | `MemorySecretStore`: in-memory `SecretStore` for other modules' tests |

## Public surface

- `SecretStore` interface (`keychain.ts:6`): `get` (null when missing), `set`, `delete`.
- `createSecretStore(platform = process.platform)` (`platform.ts:7`): `darwin` → `Keychain`, `linux` → `SecretTool`, anything else throws `INTERNAL` (`unsupported platform "<p>"`). Used by `src/cli.ts:42,73,81` and as `startDaemon`'s default (`src/daemon/daemon.ts:59`).
- `CommandRunner` / `CommandResult` (`runner.ts:10`, `:4`): runs a binary with args and optional stdin, returns `{ code, stdout, stderr }`. Re-exported from `keychain.ts:4`.
- `cliRunner(binary, missingHint, env?)` (`runner.ts:22`): the real `CommandRunner`; a missing binary (spawn `ENOENT`) rejects with `AppError('INTERNAL', missingHint)`. `env` is a thunk evaluated per call (default: inherit).
- `Keychain` class (`keychain.ts:29`): `new Keychain(runner?, service?)`, runner defaults to `securityCli` (`keychain.ts:21`), service to `paperplane`.
- `SecretTool` class (`secret-tool.ts:40`): `new SecretTool(runner?, service?)`, runner defaults to `secretToolCli` (`secret-tool.ts:26`), service to `paperplane`.
- `withSessionBus(env, uid, exists)` (`secret-tool.ts:16`): returns `env` with `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus` added when the variable is unset and that socket exists; `secretToolCli` applies it to every call.
- `SECRET_TOOL_MISSING_HINT` (`secret-tool.ts:7`): tells the user to `sudo apt install libsecret-tools`.
- `SECRET_ACCOUNTS` (`keychain.ts:12`): `apiHash` = `api_hash`, `bearerToken` = `bearer_token`.
- `assertSafeSecret` (`keychain.ts:58`): rejects anything outside `SAFE_VALUE` (`keychain.ts:19`) with `VALIDATION`; both backends call it on account and value.

## Key methods

- `Keychain.get` (`keychain.ts:35`): `find-generic-password ... -w`; exit 44 returns `null`, other non-zero throws `INTERNAL`; strips one trailing newline.
- `Keychain.set` (`keychain.ts:42`): validates account and value, then upserts via `security -i` with the command on stdin (`add-generic-password -U`).
- `Keychain.delete` (`keychain.ts:49`): `delete-generic-password`; a missing item (44) counts as success.
- `SecretTool.get` (`secret-tool.ts:46`): `lookup service <svc> account <acct>`; exit 1 with empty stderr, or empty output, returns `null`; strips one trailing newline.
- `SecretTool.set` (`secret-tool.ts:54`): validates, then `store --label="<svc> <acct>" service <svc> account <acct>` with the value (no newline) on stdin. `store` replaces an existing item with the same attributes.
- `SecretTool.delete` (`secret-tool.ts:64`): `clear service <svc> account <acct>`; exit 1 with empty stderr (nothing matched) counts as success.

## Dependencies

- `AppError` from `src/domain/errors.ts` (`INTERNAL`, `VALIDATION`).
- Node `child_process.spawn`.
- macOS: `/usr/bin/security` (built in).
- Linux: `secret-tool` on `PATH` (Ubuntu package `libsecret-tools`), a D-Bus session bus and an unlocked Secret Service keyring (GNOME Keyring, or KWallet with its Secret Service API).

## Gotchas & invariants

- Secret values never go in argv, on either platform: macOS writes through `security -i` on stdin, Linux pipes the value to `secret-tool store`'s stdin. Any local process can read argv from the process list.
- `pm2 startup` on Linux installs a systemd system unit that runs as the user but without `DBUS_SESSION_BUS_ADDRESS`, so after a reboot `secret-tool` could not find the session bus. `withSessionBus` fills it in from `/run/user/<uid>/bus` (present while the user has a systemd user session, or always with `loginctl enable-linger`); it never overrides a value already set. The keyring itself still has to be unlocked.
- No plaintext fallback and no native dependency (keytar is unmaintained). An unsupported platform or a missing `secret-tool` is a hard, explained error.
- Exit code 44 means item not found on macOS (`ITEM_NOT_FOUND`, `keychain.ts:16`).
- `secret-tool` exits 1 both for "no match" and for real failures (no D-Bus, locked or missing keyring). Only exit 1 with an empty stderr counts as "no match" (`isNoMatch`, `secret-tool.ts:35`). Anything else throws: treating an unreachable keyring as "missing" would make the daemon mint a new bearer token or report `auth_required` for the wrong reason.
- `SAFE_VALUE` (`[A-Za-z0-9+/=_.:-]`) exists because the macOS backend interpolates values into a `security -i` command line. The Linux backend doesn't need it for safety, but applies it too so any value valid on one platform is valid on the other and newline stripping on `get` can never corrupt a value. Binary auth keys must be base64/hex encoded by the caller.
- Error messages never include the secret value or the tool's stderr; Linux errors add a hint to check that a keyring is running and unlocked.
- `cliRunner` swallows `child.stdin` errors (`runner.ts:36`): an EPIPE when the tool exits before reading stdin (or never started) would otherwise be an uncaught `'error'` event that kills the process; the `close`/`error` handlers already report the failure.

## Testing

- `pnpm test src/secrets`: unit tests using fake `CommandRunner`s; never touch a real keyring. `secret-tool.test.ts` also covers `withSessionBus`. `platform.test.ts` spawns `node` itself to check `cliRunner` and a nonexistent path to check the missing-binary error.
- `PAPERPLANE_KEYCHAIN_IT=1 pnpm test src/secrets` (macOS) runs a real Keychain round trip under the throwaway service `paperplane-test`.
- `PAPERPLANE_SECRET_TOOL_IT=1 pnpm test src/secrets` (Linux, keyring unlocked) does the same through `secret-tool`.
- Other modules use `MemorySecretStore` (`src/testing/memory-secrets.ts`).
