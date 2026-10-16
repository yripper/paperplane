# Store Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

Paperplane's own SQLite database at `~/.paperplane/paperplane.db` (better-sqlite3, WAL, FTS5): chats, messages, labels, sync cursors, cleanup plans and the audit log. Every read tool is served from here.

## Structure (planned)

| File | Purpose |
|---|---|
| `db.ts` | Opens the DB and runs migrations |
| `schema.ts` | Migrations |
| `chats-repo.ts / messages-repo.ts / labels-repo.ts` | Repositories |
| `pending-query.ts` | SQL behind `get_pending` |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Separate from mtcute's own `mtcute.db`. Never read or write mtcute's tables.
- The audit log stores metadata only. Never message text or secrets.
- `sent_via_paperplane` must never be downgraded on re-upsert (a later live update for the same message reports it as a normal outgoing message).

## Testing

_TBD — fill on first substantive change._
