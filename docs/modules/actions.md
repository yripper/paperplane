# Actions Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/actions/` · **Last verified:** 2026-10-16

## Purpose

Side effects on Telegram on behalf of MCP tools: messaging, organizing (folders/archive/mute) and destructive operations (delete/leave/block/cleanup). Every call goes through rate limiting and the audit log.

## Structure

| File | Purpose |
|---|---|
| `context.ts` | `ActionDeps`, `acquire`, `audited`, `requireChat` |
| `messaging.ts` | send/draft/mark read |
| `organize.ts` | Folders, archive, mute |
| `destructive.ts` | delete/leave/block |
| `cleanup.ts` | Two-step cleanup plan → apply |
| `*.test.ts` | One per action file, driven by `makeActionDeps` (`src/testing/action-deps.ts:8`) |

## Public surface

All actions take `d: ActionDeps` first and a single input object.

- `ActionDeps`: `src/actions/context.ts:11` (gateway, sink, repos, `limits: { sends, chatGap, destructive }`, `now` in unix seconds, `newId`).
- `acquire(r: Acquire): void` `:24` (rejection becomes `RATE_LIMITED` with `retryAfterSec`), `audited(d, action, chatId, fn)` `:28`, `requireChat(d, chatId): ChatRow` `:39` (`NOT_FOUND` if unknown).
- messaging (`src/actions/messaging.ts`): `sendMessage` `:4`, `saveDraft` `:17`, `markRead` `:22`.
- organize (`src/actions/organize.ts`): `listFolders` `:4`, `createFolder` `:8`, `editFolder` `:12`, `deleteFolder` `:20`, `archiveChats` `:24`, `unarchiveChats` `:29`, `setChatMuted` `:34`.
- destructive (`src/actions/destructive.ts`): `deleteChat` `:7`, `leaveChat` `:27`, `blockUser` `:37`.
- cleanup (`src/actions/cleanup.ts`): `createCleanupPlan` `:15`, `applyCleanupPlan` `:31`, `CleanupReport` `:8`.

## Key methods

- `sendMessage`: validates the chat, takes the per-chat gap then the global send slot, and sends (the audited part, `messaging.ts:8`). It then stores the returned message via `sink.onMessage(..., { sentViaPaperplane: true })` (`:13`) so pending status reflects the reply before the live update. A store failure is caught and audited as `send_message.store` (error); the sent message is still returned.
- `deleteChat` modes: `delete` and `revoke` purge the chat locally; `clear` soft-deletes all messages and resets the top (`setTop(..., 0, ...)`).
- `createCleanupPlan` requires a narrowing criterion (`inactiveDays`, non-empty `types`, `minUnread`, `mutedOnly: true`, `archivedOnly: true`); `false`/empty values are rejected (`cleanup.ts:16-22`).
- `applyCleanupPlan` (`cleanup.ts:55`): re-reads each item with `recheck` (`:34`): missing chat -> `failed` `NOT_FOUND`, now `full` -> `failed` `FORBIDDEN`, no Telegram call or limiter slot. `remove` mode claims the plan with `markApplied`, then runs items one by one through the destructive limiter. `archive` mode re-checks, takes one limiter slot before `markApplied` (rate limit throws `RATE_LIMITED`, plan stays a draft), then makes one gateway call; a gateway error is returned as `failed` for every id, not thrown. If nothing is left to archive there is no call and no slot, but the plan is still marked applied.

## Dependencies

`TelegramGateway` (never mtcute directly), `UpdateSink`, `ChatsRepo`, `MessagesRepo`, `AuditRepo`, `CleanupPlansRepo`, `RateLimiter`/`PerKeyGap`, `selectForCleanup`/`cleanupActionFor` from `src/domain/cleanup-criteria.ts`.

## Gotchas & invariants

- `revoke` (delete for everyone) requires `confirm_title` matching the chat title exactly (case-sensitive), checked before Telegram is called.
- `delete_chat` refuses channels/supergroups; `leave_chat` refuses private chats (user/bot). Each error names the right tool.
- Cleanup plans expire after 30 minutes and apply one chat at a time through the limiter.
- `markApplied` makes apply single-shot: a second apply (or a concurrent one) gets `VALIDATION`.
- On rate limit mid-cleanup the rest are reported as `skipped`; after a `FLOOD_WAIT` failure the remaining items are also skipped.
- FLOOD_WAIT goes back to the caller with the wait time; actions never sleep through long waits silently.
- Audit entries are metadata only (action name, chat id, outcome); never message text or titles. `blockUser` records the user id in the chat id column.
- Sends to muted chats store no message row (the sink skips muted chats), but the chat top is still bumped.
- A cleanup plan can go stale: apply re-validates every chat against the store.
- Local state is updated only after Telegram succeeds (archive, mute, mark read, purge).
- The per-chat gap is consumed even if the global send limit then rejects.

## Testing

`pnpm test src/actions`: `messaging`, `organize`, `destructive`, `cleanup` tests use `FakeGateway` and an in-memory store with an injected clock; rate limiting, confirmation rules, audit contents, plan expiry/single-shot and partial failure are covered.
