# MCP Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/mcp/` · **Last verified:** 2026-10-16 (tools and `buildServer` implemented; `http.ts` transport not yet implemented)

## Purpose

The MCP server Claude talks to: Streamable HTTP on `127.0.0.1`, bearer-token auth and the tool definitions. This is the public surface of Paperplane.

## Structure

| File | Purpose |
|---|---|
| `server.ts` | `buildServer(deps)`, `ToolDeps`, `StatusReport` |
| `result.ts` | `ok` / `fail` / `run`: tool result envelope and `CODE: message` errors |
| `format.ts` | Row to view mappers (`formatMessage`, `formatChat`, `formatPending`), ISO dates |
| `tools/annotations.ts` | `READ`, `LOCAL_WRITE`, `TELEGRAM_WRITE`, `DESTRUCTIVE` hint sets |
| `tools/{read,tracking,messaging,organize,destructive}.ts` | One `register*Tools(server, deps)` per group |
| `http.ts` (planned) | `node:http` server: Host check, bearer auth, stateless transport per request |

## Public surface

25 tools (annotation: R = readOnly, LW = local write, TW = Telegram write, D = destructive).

| Tool | Group | Ann. | What it does |
|---|---|---|---|
| `status` | read | R | Auth state, last update/sweep, store size |
| `list_chats` | read | R | Filtered chat list from the mirror |
| `get_pending` | read | R | Chats waiting on my reply |
| `read_history` | read | R (open world) | Messages newest first, backfills from Telegram if short |
| `search_messages` | read | R (open world) | FTS over the mirror, or `remote=true` via gateway |
| `get_chat_info` | read | R | One chat with effective status and label |
| `set_label` | tracking | LW | done / waiting / snoozed (needs `snooze_until`) |
| `clear_label` | tracking | LW | Remove a label |
| `set_watch_level` | tracking | LW | full / normal / muted; warns above 10 full chats |
| `send_message` | messaging | TW | Send as me |
| `save_draft` | messaging | TW | Draft in Telegram's input box |
| `mark_read` | messaging | TW | Mark chat read |
| `list_folders` | organize | R (open world) | Telegram folders |
| `create_folder` / `edit_folder` / `delete_folder` | organize | TW | Folder management |
| `archive_chats` / `unarchive_chats` | organize | TW | Archive control |
| `mute_chat` / `unmute_chat` | organize | TW | Notification mute |
| `delete_chat` | destructive | D | delete / clear / revoke (revoke needs `confirm_title`) |
| `leave_chat` | destructive | D | Leave group or channel |
| `block_user` | destructive | D | Block user |
| `cleanup_plan` | destructive | R | Step 1: list matches, no side effects (needs >= 1 criterion) |
| `cleanup_apply` | destructive | D | Step 2: execute plan minus exclusions |

Errors come back as `isError: true` with text `CODE: message` (plus `(retry after Ns)`). Invalid arguments are rejected by the SDK's zod validation before any handler runs.

## Key methods

- `buildServer(deps: ToolDeps): McpServer` (`src/mcp/server.ts:30`): registers all five groups on a fresh `McpServer`.
- `ToolDeps` (`src/mcp/server.ts:22`) / `StatusReport` (`src/mcp/server.ts:13`): everything tools need; `status` is injected by the daemon.
- `run(fn)` (`src/mcp/result.ts:16`): wraps a handler, `ok` (`:4`) for JSON text, `fail` (`:10`) maps `AppError` to `CODE: message`, anything else to `INTERNAL`.
- `formatMessage` / `formatChat` / `formatPending` (`src/mcp/format.ts:37`, `:51`, `:66`).

## Dependencies

`src/actions/*` (all writes), `src/sync/backfill.ts` (`readHistory`), `src/store/pending-query.ts` (`listPending`), `src/store/labels-repo.ts`, `src/sync/update-sink.ts` (`toMessageRow`), `src/domain/{errors,pending}.ts`; `@modelcontextprotocol/sdk` and `zod`. Never imports `@mtcute/*`.

## Gotchas & invariants

- Stateless pattern from the SDK examples: a new `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST, closed on `res` close; GET and DELETE return 405.
- The SDK's bearer middleware and host validation are Express-only, so Paperplane checks `Authorization` (constant-time) and `Host` ourselves. Host checks are what block DNS-rebinding from a browser.
- Claude Desktop can't reach localhost through Connectors (they run in Anthropic's cloud); it connects via `npx mcp-remote <url> --header ...`.
- Tool annotations (`readOnlyHint`, `destructiveHint`) are hints only. The real safety is that write tools are never allowlisted in the Claude permission settings.

- Tool descriptions carry the "show the user and get approval first" instructions for write tools; they are the only place Claude is told that.
- `cleanup_plan` is annotated read-only on purpose: it only stores a draft, so it is safe to allowlist. `cleanup_apply` is the destructive step.

## Testing

`src/mcp/server.test.ts` uses an in-memory MCP client (`connect` and `makeToolDeps` in `src/testing/tool-deps.ts`) against `FakeGateway` and an in-memory store. It covers: the tool list and annotations, `get_pending`, `read_history`, `search_messages`, `send_message` (success, empty text, `AUTH_REQUIRED`, `FLOOD_WAIT`, plain `Error` as `INTERNAL`), `delete_chat` revoke without confirmation, `set_label` and `clear_label`, `cleanup_plan` (including rejection of criteria that narrow nothing) and `cleanup_apply`, and oversized-input rejection. Not covered: `status`, `list_chats`, `get_chat_info`, `set_watch_level`, `save_draft`, `mark_read`, the folder tools, archive/mute tools, `leave_chat`, `block_user`. `src/mcp/format.test.ts` covers `formatMessage`.
