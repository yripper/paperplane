# Store Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/` · **Last verified:** 2026-10-16 (schema layer and chats/messages repositories implemented; `labels-repo.ts` and `pending-query.ts` still planned)

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
| `db.test.ts`, `chats-repo.test.ts`, `messages-repo.test.ts` | Schema/migrations/FTS sync; repository behavior |

Planned, not yet written: `labels-repo.ts` (repository) and `pending-query.ts` (SQL behind `get_pending`).

## Public surface

- `type Db = Database.Database`: `src/store/db.ts:4`
- `openDb(file: string): Db`: `src/store/db.ts:6` (`':memory:'` allowed)
- `migrate(db: Db): void`: `src/store/db.ts:14`
- `MIGRATIONS`: `src/store/schema.ts:3`
- Row types `ChatType`, `WatchLevel`, `LabelKind`, `ChatRow`, `MessageRow`, `ChatLabel`: `src/store/types.ts:1-43`. Row types use camelCase and booleans; SQL columns are snake_case with 0/1 integers, so repositories must map.
- `ChatsRepo`: `src/store/chats-repo.ts:54`. Helpers `rowToChat` `:33` (exported for pending-query), `ChatSeed` `:4`, `DialogSnapshot` `:11`, `ChatFilter` `:23`.
- `MessagesRepo`: `src/store/messages-repo.ts:29`.

## Key methods

- `migrate` runs each pending migration `v` in its own transaction and sets `user_version = v + 1`. Idempotent.

- `ChatsRepo`: `ensure` `:59` (insert once; later only title/username/type), `get` `:69`, `list` `:74`, `allIds` `:99`, `bumpTop` `:104`, `setTop` `:114`, `incrementUnread` `:120`, `setReadInbox` `:124`, `setReadOutbox` `:133`, `applySnapshot` `:142`, `setWatchLevel` `:163`, `setMuted` `:167`, `setArchived` `:171`, `purge` `:177` (also deletes messages, chat_labels, sync_cursors), `count` `:186`.
- `MessagesRepo`: `upsert` `:32`, `softDelete` `:44`, `softDeleteNonChannel` `:51` (returns affected chat ids), `softDeleteAll` `:64`, `history` `:68`, `latestAlive` `:79`, `oldestStored` `:86` (includes deleted rows), `search` `:91`, `count` `:102`.

## Dependencies

`better-sqlite3`. No other Paperplane module.

## Gotchas & invariants

- Migrations are append-only: never edit a shipped entry in `MIGRATIONS`, add a new one.
- `messages_fts` is FTS5 external content over `messages`; the `messages_ai/ad/au` triggers keep it in sync. `messages` has a surrogate `id` because external content needs an integer rowid. Write `messages` only via SQL that fires the triggers.
- All timestamps are unix seconds.
- Separate from mtcute's own `mtcute.db`. Never read or write mtcute's tables.
- The audit log stores metadata only. Never message text or secrets.
- `sent_via_paperplane` must never be downgraded on re-upsert (a later live update for the same message reports it as a normal outgoing message). `MessagesRepo.upsert` enforces it with `MAX(...)` (`messages-repo.ts:37-41`).
- Upserts must use `ON CONFLICT ... DO UPDATE`, never `INSERT OR REPLACE`: REPLACE deletes the old row without firing the FTS delete trigger (`recursive_triggers` is off), leaving stale `messages_fts` rows.
- Soft-deleted messages stay in `messages_fts`, so every read must filter `deleted_at IS NULL` (`history`, `latestAlive`, `search` do).
- `bumpTop` and read positions (`setReadInbox`, `setReadOutbox`, `applySnapshot`) are monotonic: late duplicates must not roll them back. Use `setTop` for the unconditional case (top message deleted).
- `ChatsRepo.ensure` never touches `watch_level` after first insert.
- FTS queries are token-quoted by `toFtsQuery` (`messages-repo.ts:24`) so FTS5 operators are matched literally; an empty query returns `[]`.
- Non-channel deletions are account-global: Telegram omits the chat id, so `softDeleteNonChannel` matches by `msg_id` across all chats with id above the channel bound.

## Testing

`pnpm test src/store` uses `:memory:` databases only.
