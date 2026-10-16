# Paperplane

Local daemon that logs into a personal Telegram account (MTProto user client via `@mtcute/node`), mirrors it into SQLite, and exposes an MCP server (Streamable HTTP on `127.0.0.1`) so Claude can read, track, answer and organize Telegram conversations. Runs under pm2 on macOS.

## Hard rules

- **Public repo.** Never commit anything personal: no session data, DB files, real chat ids, names, phone numbers or message text (including in fixtures, tests and logs). All runtime state lives in `~/.paperplane/` (override with `PAPERPLANE_HOME`), never in the repo.
- **Never commit `docs/superpowers/` or `.superpowers/`.** They're local planning docs and are gitignored. Check with `git check-ignore -v` before a first commit.
- Secrets live in the macOS Keychain (service `paperplane`), never in env files or on disk.
- Never log message content.
- Only `src/telegram/` imports mtcute.

## Module Documentation Convention (MANDATORY)

Every module has a living doc at `docs/modules/<module>.md` (flat file, one per module). `docs/modules/README.md` is the index that routes a module's source path → its doc. These are the fast on-ramp for anyone — human or agent — touching a module.

**Progressive disclosure — do NOT load all docs at once.** When you're about to touch a module, open `docs/modules/README.md`, find the ONE doc matching the code you're changing, and read only that. Never pull the whole `docs/modules/` folder into context.

**The workflow rule:**
1. **Before modifying a module, read its `docs/modules/<module>.md` first.** It holds the file map, key methods with `file:line`, dependencies, and gotchas.
2. **After modifying a module, update its doc in the same change.** New/removed endpoints, changed behavior, new gotchas, dependency changes — all go into the doc before the work is done. Bump the "Last verified" date.
3. Doc claims must be verified against source and cite `file:line`. Never document something you haven't confirmed exists.
4. **Adding a new module?** Create its `docs/modules/<module>.md` and add a row to `docs/modules/README.md` in the same change.

Docs follow a shared template: Purpose, Structure, Endpoints/Public surface, Key methods (`file:line`), Dependencies, Gotchas & invariants, Testing.
