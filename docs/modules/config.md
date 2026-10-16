# Config Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/config/` · **Last verified:** 2026-10-16 (`style.md` path)

## Purpose

Resolves where Paperplane keeps its state (the `~/.paperplane` layout, overridable with `PAPERPLANE_HOME`) and loads/saves the zod-validated `config.json`. Secrets never live here; they are in the macOS Keychain.

## Structure

| File | Purpose |
|---|---|
| `paths.ts` | `AppPaths` layout (`config.json`, `paperplane.db`, `mtcute.db`, `paperplane.lock`, optional `style.md`) and home-dir creation |
| `config.ts` | zod `configSchema`, load/save of `config.json`, `requireApiId` |
| `paths.test.ts`, `config.test.ts` | Unit tests (temp dirs only) |

## Public surface

- `interface AppPaths` — `src/config/paths.ts:5`
- `resolvePaths(env?)` — `src/config/paths.ts:15`
- `ensureHome(paths)` — `src/config/paths.ts:28`
- `configSchema`, `type Config` — `src/config/config.ts:7`, `src/config/config.ts:20`
- `loadConfig(path)` — `src/config/config.ts:22`
- `saveConfig(path, config)` — `src/config/config.ts:38`
- `requireApiId(config)` — `src/config/config.ts:43`

## Key methods

- `loadConfig` returns defaults when the file is missing; malformed JSON or out-of-range values throw `AppError('VALIDATION')` (`src/config/config.ts:22-36`).
- `requireApiId` throws `VALIDATION` pointing the user at `paperplane login` (`src/config/config.ts:43`).

## Dependencies

`zod`, `node:fs`/`node:os`/`node:path`; `AppError` from `src/domain/errors.ts`.

## Gotchas & invariants

- zod 4's `.default()` does not re-parse inner defaults, so `defaultWatchLevel` carries a full literal default (`src/config/config.ts:15-17`).
- `mode` on `mkdirSync`/`writeFileSync` only applies on creation, hence the explicit `chmodSync` (`src/config/paths.ts:28-31`, `src/config/config.ts:38-41`).
- The home directory is `0700` and `config.json` is `0600`.

## Testing

`pnpm test src/config`. Tests use `mkdtempSync` directories and never touch the real `~/.paperplane`.
