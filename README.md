# Paperplane

A local daemon that connects to your personal Telegram account (MTProto user client), mirrors it into SQLite, and exposes an MCP server so Claude Code and Claude Desktop can read, track, answer and organize your Telegram conversations.

> **Status:** early development. Module docs live in [docs/modules](docs/modules/README.md).

## Privacy

Paperplane runs entirely on your machine. All state (config, message store, session) lives in `~/.paperplane/`, outside this repository. Bring your own `api_id`/`api_hash` from [my.telegram.org](https://my.telegram.org).

Before using it, read Telegram's [API Terms of Service](https://core.telegram.org/api/terms) — §1.5 restricts using Telegram data with AI systems, and you should judge for yourself whether your use fits.

## License

MIT
