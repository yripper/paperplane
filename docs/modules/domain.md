# Domain Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/domain/` · **Last verified:** 2026-10-16 (all files implemented)

## Purpose

Pure logic with no I/O: pending status, label precedence/reset rules, cleanup selection criteria and rate limiting. This is the easiest place to get product behavior wrong, so it gets the densest tests.

## Structure

| File | Purpose |
|---|---|
| `errors.ts` | `AppError` + `ErrorCode`: the one error type crossing module boundaries (`src/domain/errors.ts:13`); `describeError` (`:26`) formats any thrown value for logs |
| `peer-ids.ts` | `isChannelId`: marked-id classification (`src/domain/peer-ids.ts:3`) |
| `pending.ts` | Auto status (pending/seen/clear) + label precedence (`src/domain/pending.ts:15`, `:20`, `:28`) |
| `cleanup-criteria.ts` | Selects chats for `cleanup_plan` (`src/domain/cleanup-criteria.ts:18`, `:32`) |
| `rate-limiter.ts` | Sliding-window `RateLimiter` and per-key `PerKeyGap` (`src/domain/rate-limiter.ts:6`, `:27`) |

## Public surface

- `describeError(e: unknown): string`: `src/domain/errors.ts:26`. Log-safe `CODE: message` / `Name: message`; non-Error values become `unknown error`.
- `isChannelId(id: number): boolean`: `src/domain/peer-ids.ts:3`. True for ids below -1_000_000_000_000 (mtcute marked channel/supergroup ids).

- `autoStatus(c: PendingInput): AutoStatus`: `src/domain/pending.ts:15`. `clear` if muted, empty (`topMsgId === 0`) or last message is mine; else `seen` when `readInboxMaxId >= topMsgId`, otherwise `pending`.
- `effectiveStatus(c, label, nowSec): EffectiveStatus`: `src/domain/pending.ts:20`. Label wins; an expired snooze (`snoozeUntil <= nowSec`) falls back to `autoStatus`.
- `labelSurvivesIncoming(label: ChatLabel): boolean`: `src/domain/pending.ts:28`. Only `snoozed` survives a new incoming message.
- Types `AutoStatus` `:3`, `EffectiveStatus` `:4`, `PendingInput` `:6`.
- `class RateLimiter`: `src/domain/rate-limiter.ts:6`. `new RateLimiter(maxPerWindow, windowMs, now = Date.now)`; `tryAcquire(): Acquire` at `:15`. Sliding window: at most `maxPerWindow` accepted hits per `windowMs`.
- `class PerKeyGap`: `src/domain/rate-limiter.ts:27`. `new PerKeyGap(gapMs, now = Date.now)`; `tryAcquire(key: number): Acquire` at `:35`. Minimum gap of `gapMs` per key, independent across keys.
- Type `Acquire` `src/domain/rate-limiter.ts:1`: `{ ok: true } | { ok: false; retryAfterMs: number }`.
- `selectForCleanup(chats, c, nowSec): ChatRow[]`: `src/domain/cleanup-criteria.ts:18`. Criteria combine with AND; `full` watch-level chats are never selected. `mutedOnly` matches `muted` flag or `muted` watch level.
- `cleanupActionFor(type, mode): CleanupAction`: `:32`. `archive` mode always archives; `remove` deletes user/bot chats and leaves groups/channels.
- Types `CleanupCriteria` `:3`, `CleanupMode` `:11`, `CleanupAction` `:12`.

## Key methods

Functions in `pending.ts`/`peer-ids.ts` are pure. The rate limiters are pure too: the clock is injected via `now`, so tests drive time without sleeping.

## Dependencies

Type-only imports from `src/store/types.ts` (`ChatLabel`, `LabelKind`, `WatchLevel`) in `pending.ts`.
Store imports of domain must stay pure functions; domain imports from store are type-only.

## Gotchas & invariants

- Marked ids: channels/supergroups are `-100xxxxxxxxxx`, legacy groups small negatives, users positive. The store duplicates the bound as `CHANNEL_ID_BOUND` in `src/store/messages-repo.ts:4` (the store may import pure, I/O-free domain functions such as `effectiveStatus`; the bound is duplicated only to keep that file self-contained).
- pending = the last message isn't mine and the chat isn't muted; seen = pending, but my read position has passed it. Labels override automatic status; an expired snooze falls back to automatic; a new incoming message resets `done`/`waiting` (`labelSurvivesIncoming`, `src/domain/pending.ts:28`; applying the reset is the caller's job).
- Rate limits reject, never sleep. A limiter returns `{ ok: false, retryAfterMs }` and the caller maps it to `RATE_LIMITED` (with `retryAfterSec`) for Claude. A tool call that silently blocks for a minute looks hung; a clear "retry in N seconds" is recoverable. Rejected attempts are not recorded, so a retry loop cannot extend its own lockout.

## Testing

`pnpm test src/domain`: `peer-ids.test.ts`, `cleanup-criteria.test.ts`, `pending.test.ts` (status derivation, label override, snooze expiry, reset rule), `rate-limiter.test.ts` (window capacity and `retryAfterMs`, window sliding, rejected attempts not recorded, per-key gap independence).
