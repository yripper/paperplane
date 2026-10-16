# Sync Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/sync/` · **Last verified:** 2026-10-16 (partially implemented: `update-sink.ts` exists; `sweep.ts` and `backfill.ts` are planned)

## Purpose

Keeps the local store mirroring Telegram: applies live updates (new/edit/delete/read), runs the periodic safety sweep, and does history backfill. Telegram is the source of truth, and the store is only written from what Telegram reports.

## Structure (`update-sink.ts` implemented, rest planned)

| File | Purpose |
|---|---|
| `update-sink.ts` | Applies `Tg*` events to the store and resets labels on incoming messages |
| `sweep.ts` | Periodic dialog sweep: compares top message ids and fetches only the delta |
| `backfill.ts` | Resumable per-chat history backfill (full watch level + on demand) |

## Public surface

- `SinkDeps` (`src/sync/update-sink.ts:10`): `db`, the three repos, `watchDefaults` per `ChatType` and `now` (unix seconds).
- `toMessageRow(m, sentViaPaperplane)` (`update-sink.ts:20`): `TgMessage` → `MessageRow`.
- `UpdateSink` (`update-sink.ts:38`): the only writer of synced state; constructed as `new UpdateSink(deps)`.

## Key methods

- `ensureChat(peer, mutedInTelegram?)` (`update-sink.ts:41`): creates the chat if missing (muted in Telegram on first sight → `muted`, else the type default) and returns the row.
- `onMessage(m, { live, sentViaPaperplane })` (`update-sink.ts:49`): upserts the message (unless the chat is `muted`), bumps the top, and for a newer incoming message increments unread (live only) and resets `done`/`waiting` labels.
- `onEdit(m)` (`update-sink.ts:64`): upserts the edited message; never touches unread.
- `onDelete(e)` (`update-sink.ts:71`): soft-deletes by channel id, or across non-channel chats when `channelId` is null, and recomputes the top if it was deleted.
- `onRead(e)` (`update-sink.ts:90`): updates read cursors/unread; ignores chats not yet known.

## Dependencies

- Store repos and row types (`src/store/`), `labelSurvivesIncoming` (`src/domain/pending.ts`), `AppError`, and the plain `Tg*` types from `src/telegram/types.ts` (never mtcute).

## Gotchas & invariants

- Telegram admits it may stop pushing channel updates (core.telegram.org/api/updates), so the sweep is a deliberate backstop, not a hack. It runs every few minutes, not every 15s.
- Writes are idempotent on `(chat_id, msg_id)`. Duplicates from catch-up, the sweep and live updates racing are expected and harmless.
- Messages I send from my phone arrive as `isOutgoing` updates. That's how pending clears without Paperplane doing anything special.
- `DeleteMessageUpdate.channelId` is null for private chats and legacy groups, whose message ids are account-global. Soft-delete those only in non-channel chats.
- A new incoming message resets `done` and `waiting` labels (see the domain module).
- Only live updates increment unread (`update-sink.ts:58`); sweep snapshots carry Telegram's own count, and a duplicate delivery (id not newer than the top) never double counts.
- Muted chats store metadata only: the chat row and top are updated but no message rows are written (`update-sink.ts:53`).
- Deleting the top message recomputes the top from the latest alive message (`update-sink.ts:85`), falling back to 0 when none is left.
- Reads for chats the store has never seen are ignored; the next sweep creates them with full state.

## Testing

- `pnpm test src/sync`: `update-sink.test.ts` runs against an in-memory DB via `makeStore()`/`makeSink()` from `src/testing/fixtures.ts` (synthetic data only).
