# Telegram Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/telegram/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

The only module that imports mtcute. Owns the MTProto user client (login, live updates, catch-up), a Keychain-backed auth-key store, and the `TelegramGateway` adapter that converts mtcute types into plain Paperplane types and mtcute errors into `AppError`s. If this breaks, nothing syncs and no action reaches Telegram.

## Structure (planned)

| File | Purpose |
|---|---|
| `client.ts` | Builds the `TelegramClient` with composite storage and log redirection |
| `keychain-auth-keys.ts` | mtcute auth-key repository backed by macOS Keychain |
| `adapt.ts` | mtcute `Message`/`Dialog`/`Peer` → plain `Tg*` types |
| `gateway.ts` | `TelegramGateway` interface + mtcute implementation, error mapping |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Built on `@mtcute/node` 0.32.x (pinned). GramJS was rejected: it has no update-gap recovery (no `getDifference`/`getChannelDifference`), so channel pushes silently stop (gram-js/gramjs#654), and the repo was archived 2026-07-14.
- Exactly one process may own the session. Two processes on one auth key cause `AUTH_KEY_DUPLICATED`, hence the daemon's lock file.
- `updates.catchUp: true` replays downtime but can emit duplicates after an unclean shutdown. Every downstream write must be idempotent.
- Peer ids are marked plain numbers (channels `-100…`). Resolving a numeric id only works if the peer is in mtcute's cache, so `iterDialogs` runs at startup to seed it, otherwise you get `MtPeerNotFoundError`.
- Composite storage: mtcute's storage managers only read `driver`, `kv`, `authKeys`, `peers` and `refMessages` off the provider, so `authKeys` can be swapped for a Keychain repo while the rest stays in `~/.paperplane/mtcute.db`. `IAuthKeysRepository.set` must persist immediately, with no batching.
- Folder titles are `tl.TypeTextWithEntities` (`{ _: 'textWithEntities', text, entities: [] }`), not strings. `includePeers`, `excludePeers` and `pinnedPeers` are all required on a `RawDialogFilter`.
- There's no high-level mute method; use the raw `account.updateNotifySettings` call with `inputNotifyPeer` and `inputPeerNotifySettings.muteUntil`.
- mtcute retries FLOOD_WAIT up to `maxWait` 10s / 5 retries by default. Above that it throws `tl.RpcError` (`code 420`, wait time in `.seconds`), which the gateway maps to `AppError('FLOOD_WAIT')`.
- Never log message content. mtcute's log handler is redirected and must drop the `args`.

## Testing

_TBD — fill on first substantive change._
