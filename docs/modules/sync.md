# Sync Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/sync/` · **Last verified:** 2026-10-16 (senders stored by the sink, `resolveSenders`)

## Purpose

Keeps the local store mirroring Telegram: applies live updates (new/edit/delete/read), runs the periodic safety sweep, and does history backfill. Telegram is the source of truth, and the store is only written from what Telegram reports.

## Structure

| File | Purpose |
|---|---|
| `update-sink.ts` | Applies `Tg*` events to the store and resets labels on incoming messages |
| `sweep.ts` | Periodic dialog sweep: compares top message ids and fetches only the delta |
| `backfill.ts` | Resumable per-chat history backfill (full watch level + on demand) |
| `senders.ts` | `resolveSenders`: names for message senders, fetching unknown users once |

## Public surface

- `SinkDeps` (`src/sync/update-sink.ts:11`): `db`, the chats/messages/labels/senders repos, `watchDefaults` per `ChatType` and `now` (unix seconds).
- `toMessageRow(m, sentViaPaperplane)` (`update-sink.ts:22`): `TgMessage` → `MessageRow`.
- `UpdateSink` (`update-sink.ts:40`): the only writer of synced state; constructed as `new UpdateSink(deps)`.
- `runSweep(d: SweepDeps): Promise<SweepReport>` (`sweep.ts:55`), `toSnapshot(dialog)` (`sweep.ts:38`), `SweepDeps` `:6`, `SweepReport` `:14` (includes `purgeSkipped`).
- `backfillPage(d, chatId, pageSize?)` (`backfill.ts:22`), `readHistory(d, chatId, { limit, beforeId?, refresh? })` (`backfill.ts:40`), `backfillFullChats(d)` (`backfill.ts:59`), `BackfillDeps` `:9`.

## Key methods

- `ensureChat(peer, mutedInTelegram?)` (`update-sink.ts:43`): creates the chat if missing (muted in Telegram on first sight → `muted`, else the type default) and returns the row.
- `onMessage(m, { live, sentViaPaperplane })` (`update-sink.ts:51`): upserts the message and its sender (unless the chat is `muted`), bumps the top, and for a newer incoming message increments unread (live only) and resets `done`/`waiting` labels.
- `onEdit(m)` (`update-sink.ts:66`): upserts the edited message and its sender; never touches unread.
- `onDelete(e)` (`update-sink.ts:78`): soft-deletes by channel id, or across non-channel chats when `channelId` is null, and recomputes the top if it was deleted.
- `onRead(e)` (`update-sink.ts:97`): updates read cursors/unread; ignores chats not yet known.

- `runSweep` (`sweep.ts:55`): iterates dialogs; per dialog `syncDialog` (`sweep.ts:97`) ensures the chat, fetches the delta after the stored top via `fetchDelta` (`sweep.ts:121`: pages backward 100 at a time, at most `MAX_DELTA_PAGES` = 10; never for `muted` chats or first sight, which store only the top), then applies the Telegram snapshot (monotonic top/read positions). One dialog failing is logged and counted, not fatal. Chats absent from the pass are purged only when the whole iteration completed and the chat wasn't touched since the sweep began (`purgeMissing`, `sweep.ts:84`; `touchedSince` `:114`). A sanity guard (`:88`) then skips the purge entirely, sets `purgeSkipped: true` and logs `sweep: purge skipped (would remove X of Y chats)` (counts only) when the pass saw no dialogs at all or the purge would remove more than max(5, 25% of stored chats) (`PURGE_MIN_CAP` / `PURGE_MAX_SHARE`, `:35-36`): that pattern is far likelier a glitchy dialog list than real deletions, and a purge can't be undone. `purgeSkipped` reaches Claude through `status.lastSweep`; `iterationError` carries `AUTH_REQUIRED` for a revoked session.
- `backfillPage` (`backfill.ts:22`): fetches one page older than the cursor (or oldest stored message), stores it through the sink, and saves the cursor; a short page marks `backfillComplete`.
- `readHistory` (`backfill.ts:40`): `NOT_FOUND` for unknown chats; muted chats read straight from Telegram without storing; otherwise serves from the store and backfills up to 5 pages (`MAX_PAGES_PER_READ`) when short. `refresh` first re-fetches the requested page through the sink, rewriting stored text and senders (for messages mirrored before senders and hidden links were kept).
- `resolveSenders(d, ids)` (`senders.ts:15`): stored senders first; negative ids (a chat posting as itself) are named from the chats table; unknown positive ids go to `gateway.getUsers` in one batch and are stored. Telegram failures are swallowed: names are best effort and must never break a read.
- `backfillFullChats` (`backfill.ts:59`): one page for each `full` chat whose backfill isn't complete; per-chat failures are logged.

## Dependencies

- Store repos and row types (`src/store/`), `labelSurvivesIncoming` (`src/domain/pending.ts`), `AppError`, and the plain `Tg*` types from `src/telegram/types.ts` (never mtcute).

## Gotchas & invariants

- Telegram admits it may stop pushing channel updates (core.telegram.org/api/updates), so the sweep is a deliberate backstop, not a hack. It runs every few minutes, not every 15s.
- Writes are idempotent on `(chat_id, msg_id)`. Duplicates from catch-up, the sweep and live updates racing are expected and harmless.
- Messages I send from my phone arrive as `isOutgoing` updates. That's how pending clears without Paperplane doing anything special.
- `DeleteMessageUpdate.channelId` is null for private chats and legacy groups, whose message ids are account-global. Soft-delete those only in non-channel chats.
- A new incoming message resets `done` and `waiting` labels (see the domain module).
- Only live updates increment unread (`update-sink.ts:60`); sweep snapshots carry Telegram's own count, and a duplicate delivery (id not newer than the top) never double counts.
- Muted chats store metadata only: the chat row and top are updated but no message or sender rows are written (`update-sink.ts:55`).
- Deleting the top message recomputes the top from the latest alive message (`update-sink.ts:92`), falling back to 0 when none is left.
- Reads for chats the store has never seen are ignored; the next sweep creates them with full state.

- A delta is fetched newest-first in pages of 100 up to 10 pages (1000 messages). If a chat missed more than that, the oldest part of the gap stays unfetched and `chat <id>: delta gap left` is logged; backfill won't fill it (it pages from the oldest stored message, which is older than the gap).
- `iterDialogs` pages by top-message date, so a chat that gets a message mid-sweep may never be yielded. The purge step skips any chat whose `updated_at` is at/after the sweep start (`ChatsRepo.ensure` on insert and `bumpTop`/`incrementUnread` set it), so live chats and their labels survive.
- The sweep never writes unread increments; it applies Telegram's own counts via `applySnapshot`.

## Testing

- `pnpm test src/sync`: `senders.test.ts` covers store hits without a call, chats named from the chats table, one batched fetch for unknown ids, never fetching negative ids, and failure fallback. `backfill.test.ts` (including `refresh` rewriting stale text and senders), `update-sink.test.ts` (including sender storage and none for muted chats), `sweep.test.ts` and `backfill.test.ts` run against an in-memory DB via `makeStore()`/`makeSink()` from `src/testing/fixtures.ts` (synthetic data only). `sweep.test.ts` covers both purge-guard triggers (no dialogs seen; more than max(5, 25%)) and a small purge of exactly 5 still going through.
