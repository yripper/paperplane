# Actions Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/actions/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

Side effects on Telegram on behalf of MCP tools: messaging, organizing (folders/archive/mute) and destructive operations (delete/leave/block/cleanup). Every call goes through rate limiting and the audit log.

## Structure (planned)

| File | Purpose |
|---|---|
| `messaging.ts` | send/draft/mark read |
| `organize.ts` | Folders, archive, mute |
| `destructive.ts` | delete/leave/block |
| `cleanup.ts` | Two-step cleanup plan → apply |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- `revoke` (delete for everyone) requires `confirm_title` matching the chat title exactly.
- Cleanup plans expire after 30 minutes and apply one chat at a time through the limiter.
- FLOOD_WAIT goes back to the caller with the wait time; actions never sleep through long waits silently.

## Testing

_TBD — fill on first substantive change._
