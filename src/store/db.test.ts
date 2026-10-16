import { describe, expect, it } from 'vitest';
import { migrate, openDb } from './db.js';

describe('openDb', () => {
  it('creates every table and sets user_version', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['audit_log', 'chat_labels', 'chats', 'cleanup_plans', 'messages', 'messages_fts', 'sync_cursors']),
    );
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('migrate is idempotent', () => {
    const db = openDb(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('keeps the FTS index in sync on insert, update and delete', () => {
    const db = openDb(':memory:');
    const count = (q: string): number =>
      (db.prepare('SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?').get(q) as { n: number }).n;
    db.prepare("INSERT INTO messages (chat_id, msg_id, date, out, text) VALUES (1, 1, 0, 0, 'hello world')").run();
    expect(count('hello')).toBe(1);
    db.prepare("UPDATE messages SET text = 'goodbye' WHERE chat_id = 1 AND msg_id = 1").run();
    expect(count('hello')).toBe(0);
    expect(count('goodbye')).toBe(1);
    db.prepare('DELETE FROM messages').run();
    expect(count('goodbye')).toBe(0);
  });
});
