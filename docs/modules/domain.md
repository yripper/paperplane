# Domain Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/domain/` · **Last verified:** 2026-10-16 (`errors.ts`, `peer-ids.ts` and `pending.ts` implemented; rest planned)

## Purpose

Pure logic with no I/O: pending status, label precedence/reset rules, cleanup selection criteria and rate limiting. This is the easiest place to get product behavior wrong, so it gets the densest tests.

## Structure (planned)

| File | Purpose |
|---|---|
| `errors.ts` | `AppError` + `ErrorCode`: the one error type crossing module boundaries (`src/domain/errors.ts:13`) |
| `peer-ids.ts` | `isChannelId`: marked-id classification (`src/domain/peer-ids.ts:3`) |
| `pending.ts` | Auto status (pending/seen/clear) + label precedence (`src/domain/pending.ts:15`, `:20`, `:28`) |
| `cleanup-criteria.ts` | Selects chats for `cleanup_plan` |
| `rate-limiter.ts` | Sliding-window limiter |

## Public surface

- `isChannelId(id: number): boolean`: `src/domain/peer-ids.ts:3`. True for ids below -1_000_000_000_000 (mtcute marked channel/supergroup ids).

- `autoStatus(c: PendingInput): AutoStatus`: `src/domain/pending.ts:15`. `clear` if muted, empty (`topMsgId === 0`) or last message is mine; else `seen` when `readInboxMaxId >= topMsgId`, otherwise `pending`.
- `effectiveStatus(c, label, nowSec): EffectiveStatus`: `src/domain/pending.ts:20`. Label wins; an expired snooze (`snoozeUntil <= nowSec`) falls back to `autoStatus`.
- `labelSurvivesIncoming(label: ChatLabel): boolean`: `src/domain/pending.ts:28`. Only `snoozed` survives a new incoming message.
- Types `AutoStatus` `:3`, `EffectiveStatus` `:4`, `PendingInput` `:6`.

## Key methods

See Public surface; all functions are pure.

## Dependencies

Type-only imports from `src/store/types.ts` (`ChatLabel`, `LabelKind`, `WatchLevel`) in `pending.ts`.
Store imports of domain must stay pure functions; domain imports from store are type-only.

## Gotchas & invariants

- Marked ids: channels/supergroups are `-100xxxxxxxxxx`, legacy groups small negatives, users positive. The store duplicates the bound as `CHANNEL_ID_BOUND` in `src/store/messages-repo.ts:4` (the store may import pure, I/O-free domain functions such as `effectiveStatus`; the bound is duplicated only to keep that file self-contained).
- pending = the last message isn't mine and the chat isn't muted; seen = pending, but my read position has passed it. Labels override automatic status; an expired snooze falls back to automatic; a new incoming message resets `done`/`waiting` (`labelSurvivesIncoming`, `src/domain/pending.ts:28`; applying the reset is the caller's job).

## Testing

`pnpm test src/domain`: `peer-ids.test.ts`, `pending.test.ts` (status derivation, label override, snooze expiry, reset rule).
