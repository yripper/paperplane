import type { Db } from './db.js';
import type { SenderRow } from './types.js';

export class SendersRepo {
  constructor(private readonly db: Db) {}

  /// Last write wins, so renames and new usernames replace what was stored.
  upsert(s: Omit<SenderRow, 'updatedAt'>, now: number): void {
    this.db
      .prepare(
        `INSERT INTO senders (id, name, username, is_bot, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, username = excluded.username,
           is_bot = excluded.is_bot, updated_at = excluded.updated_at`,
      )
      .run(s.id, s.name, s.username, s.isBot ? 1 : 0, now);
  }

  getMany(ids: number[]): Map<number, SenderRow> {
    const found = new Map<number, SenderRow>();
    if (ids.length === 0) return found;
    const rows = this.db
      .prepare(`SELECT * FROM senders WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids)) as Record<string, unknown>[];
    for (const r of rows) {
      found.set(Number(r.id), {
        id: Number(r.id),
        name: String(r.name),
        username: (r.username as string | null) ?? null,
        isBot: r.is_bot === 1,
        updatedAt: Number(r.updated_at),
      });
    }
    return found;
  }
}
