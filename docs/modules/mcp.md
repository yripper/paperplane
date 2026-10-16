# MCP Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/mcp/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

The MCP server Claude talks to: Streamable HTTP on `127.0.0.1`, bearer-token auth and the tool definitions. This is the public surface of Paperplane.

## Structure (planned)

| File | Purpose |
|---|---|
| `http.ts` | `node:http` server: Host check, bearer auth, stateless transport per request |
| `server.ts` | `buildServer(deps)` |
| `tools/*.ts` | Tools grouped by read / tracking / messaging / organize / destructive |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Stateless pattern from the SDK examples: a new `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST, closed on `res` close; GET and DELETE return 405.
- The SDK's bearer middleware and host validation are Express-only, so Paperplane checks `Authorization` (constant-time) and `Host` ourselves. Host checks are what block DNS-rebinding from a browser.
- Claude Desktop can't reach localhost through Connectors (they run in Anthropic's cloud); it connects via `npx mcp-remote <url> --header ...`.
- Tool annotations (`readOnlyHint`, `destructiveHint`) are hints only. The real safety is that write tools are never allowlisted in the Claude permission settings.

## Testing

_TBD — fill on first substantive change._
