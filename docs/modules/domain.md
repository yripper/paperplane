# Domain Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/domain/` · **Last verified:** 2026-10-16 (`errors.ts` and `peer-ids.ts` implemented; rest planned)

## Purpose

Pure logic with no I/O: pending status, label precedence/reset rules, cleanup selection criteria and rate limiting. This is the easiest place to get product behavior wrong, so it gets the densest tests.

## Structure (planned)

| File | Purpose |
|---|---|
| `errors.ts` | `AppError` + `ErrorCode`: the one error type crossing module boundaries (`src/domain/errors.ts:13`) |
| `peer-ids.ts` | `isChannelId`: marked-id classification (`src/domain/peer-ids.ts:3`) |
| `pending.ts` | Auto status (pending/seen/clear) + label precedence |
| `cleanup-criteria.ts` | Selects chats for `cleanup_plan` |
| `rate-limiter.ts` | Sliding-window limiter |

## Public surface

- `isChannelId(id: number): boolean`: `src/domain/peer-ids.ts:3`. True for ids below -1_000_000_000_000 (mtcute marked channel/supergroup ids).

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Marked ids: channels/supergroups are `-100xxxxxxxxxx`, legacy groups small negatives, users positive. The store duplicates the bound as `CHANNEL_ID_BOUND` in `src/store/messages-repo.ts:4` (store must not depend on domain per its docs).
- pending = the last message isn't mine and the chat isn't muted; seen = pending, but my read position has passed it. Labels override automatic status; an expired snooze falls back to automatic; a new incoming message resets `done`/`waiting`.

## Testing

_TBD — fill on first substantive change._
