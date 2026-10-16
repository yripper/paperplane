# Sync Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/sync/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

Keeps the local store mirroring Telegram: applies live updates (new/edit/delete/read), runs the periodic safety sweep, and does history backfill. Telegram is the source of truth, and the store is only written from what Telegram reports.

## Structure (planned)

| File | Purpose |
|---|---|
| `update-sink.ts` | Applies `Tg*` events to the store and resets labels on incoming messages |
| `sweep.ts` | Periodic dialog sweep: compares top message ids and fetches only the delta |
| `backfill.ts` | Resumable per-chat history backfill (full watch level + on demand) |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Telegram admits it may stop pushing channel updates (core.telegram.org/api/updates), so the sweep is a deliberate backstop, not a hack. It runs every few minutes, not every 15s.
- Writes are idempotent on `(chat_id, msg_id)`. Duplicates from catch-up, the sweep and live updates racing are expected and harmless.
- Messages I send from my phone arrive as `isOutgoing` updates. That's how pending clears without Paperplane doing anything special.
- `DeleteMessageUpdate.channelId` is null for private chats and legacy groups, whose message ids are account-global. Soft-delete those only in non-channel chats.
- A new incoming message resets `done` and `waiting` labels (see the domain module).

## Testing

_TBD — fill on first substantive change._
