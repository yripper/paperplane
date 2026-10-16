# Store Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/` · **Last verified:** 2026-10-16 (schema layer implemented; repositories and `pending-query.ts` still planned)

## Purpose

Paperplane's own SQLite database at `~/.paperplane/paperplane.db` (better-sqlite3, WAL, FTS5): chats, messages, labels, sync cursors, cleanup plans and the audit log. Every read tool is served from here.

## Structure

| File | Purpose |
|---|---|
| `db.ts` | `openDb` (WAL, foreign keys, runs migrations) and `migrate` |
| `schema.ts` | `MIGRATIONS`: append-only list of SQL scripts |
| `types.ts` | Row types and string unions |
| `db.test.ts` | Tables, `user_version`, idempotent migrate, FTS sync |

Planned, not yet written: `chats-repo.ts / messages-repo.ts / labels-repo.ts` (repositories) and `pending-query.ts` (SQL behind `get_pending`).

## Public surface

- `type Db = Database.Database`: `src/store/db.ts:4`
- `openDb(file: string): Db`: `src/store/db.ts:6` (`':memory:'` allowed)
- `migrate(db: Db): void`: `src/store/db.ts:14`
- `MIGRATIONS`: `src/store/schema.ts:3`
- Row types `ChatType`, `WatchLevel`, `LabelKind`, `ChatRow`, `MessageRow`, `ChatLabel`: `src/store/types.ts:1-45`. Row types use camelCase and booleans; SQL columns are snake_case with 0/1 integers, so repositories must map.

## Key methods

- `migrate` runs each pending migration `v` in its own transaction and sets `user_version = v + 1`. Idempotent.

## Dependencies

`better-sqlite3`. No other Paperplane module.

## Gotchas & invariants

- Migrations are append-only: never edit a shipped entry in `MIGRATIONS`, add a new one.
- `messages_fts` is FTS5 external content over `messages`; the `messages_ai/ad/au` triggers keep it in sync. `messages` has a surrogate `id` because external content needs an integer rowid. Write `messages` only via SQL that fires the triggers.
- All timestamps are unix seconds.
- Separate from mtcute's own `mtcute.db`. Never read or write mtcute's tables.
- The audit log stores metadata only. Never message text or secrets.
- `sent_via_paperplane` must never be downgraded on re-upsert (a later live update for the same message reports it as a normal outgoing message).

## Testing

`pnpm test src/store` uses `:memory:` databases only.
