# Telegram Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/telegram/` · **Last verified:** 2026-10-16 (partially implemented: `types.ts` and `keychain-auth-keys.ts` exist; other files are planned)

## Purpose

The only module that imports mtcute. Owns the MTProto user client (login, live updates, catch-up), a Keychain-backed auth-key store, and the `TelegramGateway` adapter that converts mtcute types into plain Paperplane types and mtcute errors into `AppError`s. If this breaks, nothing syncs and no action reaches Telegram.

## Structure (`types.ts` and `keychain-auth-keys.ts` implemented, rest planned)

| File | Purpose |
|---|---|
| `client.ts` | Builds the `TelegramClient` with composite storage and log redirection |
| `keychain-auth-keys.ts` | mtcute auth-key repository backed by macOS Keychain |
| `adapt.ts` | mtcute `Message`/`Dialog`/`Peer` → plain `Tg*` types |
| `types.ts` | Plain `Tg*` types and the `TelegramGateway` interface (no mtcute import) |
| `gateway.ts` | mtcute implementation of `TelegramGateway`, error mapping |

## Public surface

- `TelegramGateway` (`src/telegram/types.ts:56`): the module's contract. Everything outside `src/telegram` uses it, never mtcute. `getHistory` returns newest first. Test double: `FakeGateway` (`src/testing/fake-gateway.ts`).
- Plain types (`types.ts:3-51`): `TgPeer`, `TgMessage`, `TgDialog`, `TgFolder`, `TgDeleteEvent`, `TgReadEvent`, `DeleteMode`.
- `KeychainAuthKeys` (`src/telegram/keychain-auth-keys.ts:13`): `IAuthKeysRepository` implementation, constructed as `new KeychainAuthKeys(secrets: SecretStore)`.

## Key methods

- `set(dc, key)` (`keychain-auth-keys.ts:19`): writes the key as base64 under Keychain account `authkey:<dc>` immediately; `null` deletes it.
- `get(dc)` (`keychain-auth-keys.ts:25`): reads Keychain once per DC, then serves from an in-process cache.
- `setTemp` / `getTemp` (`keychain-auth-keys.ts:33`, `:38`): temp (PFS) keys, memory only; `getTemp` returns `null` once `expires <= now`.
- `deleteByDc(dc)` (`keychain-auth-keys.ts:43`): removes the permanent key and that DC's temp keys.
- `deleteAll()` (`keychain-auth-keys.ts:48`): clears DCs 1-5 (`DC_IDS`, `:6`) and all temp keys.

## Dependencies

- `SecretStore` from `src/secrets/keychain.ts` (`KeychainAuthKeys` takes it by injection); type-only import of `IAuthKeysRepository` from `@mtcute/node`.

## Gotchas & invariants

- Built on `@mtcute/node` 0.32.x (pinned). GramJS was rejected: it has no update-gap recovery (no `getDifference`/`getChannelDifference`), so channel pushes silently stop (gram-js/gramjs#654), and the repo was archived 2026-07-14.
- Exactly one process may own the session. Two processes on one auth key cause `AUTH_KEY_DUPLICATED`, hence the daemon's lock file.
- `updates.catchUp: true` replays downtime but can emit duplicates after an unclean shutdown. Every downstream write must be idempotent.
- Peer ids are marked plain numbers (channels `-100…`). Resolving a numeric id only works if the peer is in mtcute's cache, so `iterDialogs` runs at startup to seed it, otherwise you get `MtPeerNotFoundError`.
- Composite storage: mtcute's storage managers only read `driver`, `kv`, `authKeys`, `peers` and `refMessages` off the provider, so `authKeys` can be swapped for a Keychain repo while the rest stays in `~/.paperplane/mtcute.db`. `IAuthKeysRepository.set` must persist immediately, with no batching.
- Folder titles are `tl.TypeTextWithEntities` (`{ _: 'textWithEntities', text, entities: [] }`), not strings. `includePeers`, `excludePeers` and `pinnedPeers` are all required on a `RawDialogFilter`.
- There's no high-level mute method; use the raw `account.updateNotifySettings` call with `inputNotifyPeer` and `inputPeerNotifySettings.muteUntil`.
- mtcute retries FLOOD_WAIT up to `maxWait` 10s / 5 retries by default. Above that it throws `tl.RpcError` (`code 420`, wait time in `.seconds`), which the gateway maps to `AppError('FLOOD_WAIT')`.
- Temp (PFS) auth keys are memory-only and never reach Keychain; mtcute re-negotiates them after a restart. `deleteAll` only clears DCs 1-5, since Keychain items can't be enumerated cheaply. Keychain values must match `[A-Za-z0-9+/=_.:-]`; standard base64 does.
- `types.ts` must stay free of mtcute imports; it only depends on `ChatType` from the store types.
- Never log message content. mtcute's log handler is redirected and must drop the `args`.

## Testing

- `pnpm test src/telegram`: `KeychainAuthKeys` tests run against `MemorySecretStore`; never touch the real Keychain.
