# Store Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/` · **Last verified:** 2026-10-16 (`senders` table)

## Purpose

Paperplane's own SQLite database at `~/.paperplane/paperplane.db` (better-sqlite3, WAL, FTS5): chats, messages, labels, sync cursors, cleanup plans and the audit log. Every read tool is served from here.

## Structure

| File | Purpose |
|---|---|
| `db.ts` | `openDb` (WAL, foreign keys, runs migrations) and `migrate` |
| `schema.ts` | `MIGRATIONS`: append-only list of SQL scripts |
| `types.ts` | Row types and string unions |
| `chats-repo.ts` | `ChatsRepo`, `rowToChat`, `ChatSeed`, `DialogSnapshot`, `ChatFilter` |
| `messages-repo.ts` | `MessagesRepo` (upsert, soft delete, history, FTS search) |
| `cursors-repo.ts` | `CursorsRepo` + `SyncCursor`: per-chat backfill progress |
| `labels-repo.ts` | `LabelsRepo` (upsert/get/clear), `rowToLabel` |
| `senders-repo.ts` | `SendersRepo` (upsert, `getMany`): names and usernames of message senders |
| `audit-repo.ts` | `AuditRepo`: metadata-only action log |
| `cleanup-plans-repo.ts` | `CleanupPlansRepo`, `CleanupPlan`, `CleanupItem` |
| `pending-query.ts` | `listPending`: SQL + ordering behind `get_pending` |
| `db.test.ts`, `chats-repo.test.ts`, `messages-repo.test.ts`, `pending-query.test.ts` | Schema/migrations/FTS sync; repository behavior; pending ordering |

## Public surface

- `type Db = Database.Database`: `src/store/db.ts:4`
- `openDb(file: string): Db`: `src/store/db.ts:6` (`':memory:'` allowed)
- `migrate(db: Db): void`: `src/store/db.ts:14`
- `MIGRATIONS`: `src/store/schema.ts:3`
- Row types `ChatType`, `WatchLevel`, `LabelKind`, `ChatRow`, `MessageRow`, `SenderRow`, `ChatLabel`: `src/store/types.ts`. Row types use camelCase and booleans; SQL columns are snake_case with 0/1 integers, so repositories must map.
- `ChatsRepo`: `src/store/chats-repo.ts:54`. Helpers `rowToChat` `:33` (exported for pending-query), `ChatSeed` `:4`, `DialogSnapshot` `:11`, `ChatFilter` `:23`.
- `MessagesRepo`: `src/store/messages-repo.ts:34`.
- `CursorsRepo`: `src/store/cursors-repo.ts:9`; `SyncCursor` `:3`.
- `LabelsRepo`: `src/store/labels-repo.ts:14`; `rowToLabel` `:4`.
- `SendersRepo`: `src/store/senders-repo.ts:4`; `upsert(sender, now)` (last write wins, so renames replace), `getMany(ids)` returns a map of the known ones.
- `AuditRepo`: `src/store/audit-repo.ts:4`; `CleanupPlansRepo`: `src/store/cleanup-plans-repo.ts:22`; `CleanupItem` `:5`, `CleanupPlan` `:12`.
- `listPending(db, nowSec, { limit }): PendingItem[]`: `src/store/pending-query.ts:28`; `PendingItem` `:7`.

## Key methods

- `migrate` runs each pending migration `v` in its own transaction and sets `user_version = v + 1`. Idempotent.

- `ChatsRepo`: `ensure` `:59` (insert once; later only title/username/type), `get` `:69`, `list` `:74`, `allIds` `:99`, `bumpTop` `:104`, `setTop` `:114`, `incrementUnread` `:120`, `setReadInbox` `:124`, `setReadOutbox` `:133`, `applySnapshot` `:142`, `setWatchLevel` `:163`, `setMuted` `:167`, `setArchived` `:171`, `purge` `:177` (also deletes messages, chat_labels, sync_cursors), `count` `:186`.
- `MessagesRepo`: `upsert` `:32`, `softDelete` `:44`, `softDeleteNonChannel` `:51` (returns affected chat ids), `softDeleteAll` `:64`, `history` `:68`, `latestAlive` `:79`, `oldestStored` `:86` (includes deleted rows), `search` `:91`, `count` `:102`.
- `CursorsRepo`: `get` `:12` (null when no cursor), `set` `:19` (upsert on `chat_id`). Holds `oldestSyncedMsgId` and `backfillComplete` for backfill; `ChatsRepo.purge` deletes it.
- `LabelsRepo`: `set` `:17` (upsert via ON CONFLICT), `get` `:27`, `clear` `:32`.
- `AuditRepo`: `record` `:7`, `recent` `:11` (newest first). `CleanupPlansRepo`: `insert` `:25`, `get` `:34` (parses criteria/items JSON), `markApplied` `:50` (atomic `draft` -> `applied`, returns false if already applied).
- `listPending`: SQL at `pending-query.ts:22`; in SQL keeps only users (DMs) plus groups/supergroups on `full` watch (bots, channels, normal groups and the Telegram service account 777000 `TELEGRAM_SERVICE_ID` never count), keeps only rows whose `effectiveStatus` is `pending`/`seen`, sorts `full` watch level first, then by `topMsgDate` descending (newest incoming message first; oldest-first buried current chats under years-old read-and-ignored ones), then applies `limit`. `waiting_since` = oldest alive incoming message after my last alive outgoing message, falling back to `top_msg_date` when no history is stored.

## Dependencies

`better-sqlite3`. `pending-query.ts` imports `effectiveStatus` from `src/domain/pending.ts` (the one store-to-domain dependency; the domain only imports types from the store).

## Gotchas & invariants

- Migrations are append-only: never edit a shipped entry in `MIGRATIONS`, add a new one.
- `messages_fts` is FTS5 external content over `messages`; the `messages_ai/ad/au` triggers keep it in sync. `messages` has a surrogate `id` because external content needs an integer rowid. Write `messages` only via SQL that fires the triggers.
- All timestamps are unix seconds.
- Migration 2 adds `senders` (id, name, username, is_bot, updated_at). Messages keep only `sender_id`; names live once per sender so a rename updates every transcript. Negative ids are chats posting as themselves.
- Separate from mtcute's own `mtcute.db`. Never read or write mtcute's tables.
- The audit log stores metadata only. Never message text or secrets.
- `sent_via_paperplane` must never be downgraded on re-upsert (a later live update for the same message reports it as a normal outgoing message). `MessagesRepo.upsert` enforces it with `MAX(...)` (`messages-repo.ts:44`).
- Upserts must use `ON CONFLICT ... DO UPDATE`, never `INSERT OR REPLACE`: REPLACE deletes the old row without firing the FTS delete trigger (`recursive_triggers` is off), leaving stale `messages_fts` rows.
- Soft-deleted messages stay in `messages_fts`, so every read must filter `deleted_at IS NULL` (`history`, `latestAlive`, `search` do).
- `bumpTop` and read positions (`setReadInbox`, `setReadOutbox`, `applySnapshot`) are monotonic: late duplicates must not roll them back. Use `setTop` for the unconditional case (top message deleted).
- `ChatsRepo.ensure` never touches `watch_level` after first insert.
- FTS queries are token-quoted by `toFtsQuery` (`messages-repo.ts:27`) so FTS5 operators are matched literally; an empty query returns `[]`. C0 control characters (except the whitespace ones the split uses) and DEL are stripped first (`:29`): FTS5 reads a NUL as end of string even inside quotes and throws `unterminated string`. Search never throws on user input.
- Non-channel deletions are account-global: Telegram omits the chat id, so `softDeleteNonChannel` matches by `msg_id` across all chats with id above the channel bound.

## Testing

`pnpm test src/store` uses `:memory:` databases only.
