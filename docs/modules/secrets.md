# Secrets Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/secrets/` · **Last verified:** 2026-10-16

## Purpose

macOS Keychain access through the built-in `security` CLI: api_hash, bearer token and the Telegram auth keys.

## Structure

| File | Purpose |
|---|---|
| `src/secrets/keychain.ts` | `SecretStore` / `CommandRunner` interfaces, `securityCli` runner, `Keychain` store, `SECRET_ACCOUNTS` |
| `src/secrets/keychain.test.ts` | Unit tests with a fake runner, plus an opt-in real-Keychain round trip |
| `src/testing/memory-secrets.ts` | `MemorySecretStore`: in-memory `SecretStore` for other modules' tests |

## Public surface

- `SecretStore` interface (`keychain.ts:4`): `get` (null when missing), `set`, `delete`.
- `CommandRunner` interface (`keychain.ts:9`): runs `/usr/bin/security` with args and optional stdin, returns `{ code, stdout, stderr }`.
- `securityCli` (`keychain.ts:23`): the real `CommandRunner` (spawns `/usr/bin/security`).
- `Keychain` class (`keychain.ts:41`): `new Keychain(runner?, service?)`, service defaults to `paperplane`.
- `SECRET_ACCOUNTS` (`keychain.ts:14`): `apiHash` = `api_hash`, `bearerToken` = `bearer_token`.

## Key methods

- `Keychain.get` (`keychain.ts:47`): `find-generic-password ... -w`; exit 44 returns `null`, other non-zero throws `INTERNAL`; strips one trailing newline.
- `Keychain.set` (`keychain.ts:54`): validates account and value, then upserts via `security -i` with the command on stdin (`add-generic-password -U`).
- `Keychain.delete` (`keychain.ts:61`): `delete-generic-password`; a missing item (44) counts as success.
- `assertSafe` (`keychain.ts:69`): rejects anything outside `SAFE_VALUE` (`keychain.ts:21`) with `VALIDATION`.

## Dependencies

- `AppError` from `src/domain/errors.ts` (`INTERNAL`, `VALIDATION`).
- Node `child_process.spawn`, `/usr/bin/security` (macOS only).

## Gotchas & invariants

- Writes go through `security -i` on stdin, so secret values never appear in argv or the process list.
- No native keychain dependency (keytar is unmaintained).
- Exit code 44 means item not found (`ITEM_NOT_FOUND`, `keychain.ts:18`); `get` maps it to `null`, `delete` to success.
- Values are interpolated into an interactive command line, so `set` only accepts `[A-Za-z0-9+/=_.:-]`; no spaces, quotes or newlines. Binary auth keys must be encoded (base64/hex) by the caller.
- Error messages never include the secret value.

## Testing

- `pnpm test src/secrets`: unit tests using a fake `CommandRunner`; never touches the real Keychain.
- `PAPERPLANE_KEYCHAIN_IT=1 pnpm test src/secrets` also runs a real round trip under the throwaway service `paperplane-test`.
- Other modules use `MemorySecretStore` (`src/testing/memory-secrets.ts`).
