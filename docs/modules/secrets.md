# Secrets Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/secrets/` · **Last verified:** 2026-10-16 (module not yet implemented: planned design, no code)

## Purpose

macOS Keychain access through the built-in `security` CLI: api_hash, bearer token and the Telegram auth keys.

## Structure (planned)

| File | Purpose |
|---|---|
| `keychain.ts` | get/set/delete generic passwords under service `paperplane` |

## Public surface

_TBD — fill on first substantive change._

## Key methods

_TBD — fill on first substantive change._

## Dependencies

_TBD — fill on first substantive change._

## Gotchas & invariants

- Writes go through `security -i` on stdin, so secret values never appear in argv or the process list.
- No native keychain dependency (keytar is unmaintained).

## Testing

_TBD — fill on first substantive change._
