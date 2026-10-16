import type { Db } from './db.js';
import type { MessageRow } from './types.js';

const CHANNEL_ID_BOUND = -1_000_000_000_000;

function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    chatId: Number(r.chat_id),
    msgId: Number(r.msg_id),
    senderId: r.sender_id === null ? null : Number(r.sender_id),
    date: Number(r.date),
    out: r.out === 1,
    text: String(r.text),
    mediaKind: (r.media_kind as string | null) ?? null,
    replyToMsgId: r.reply_to_msg_id === null ? null : Number(r.reply_to_msg_id),
    editedAt: r.edited_at === null ? null : Number(r.edited_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    sentViaPaperplane: r.sent_via_paperplane === 1,
  };
}

/// Quote every token so Claude's search text is matched literally: raw FTS5
/// syntax (quotes, parens, OR, NEAR, *, -) would otherwise throw SQL errors.
function toFtsQuery(query: string): string | null {
  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ') : null;
}

export class MessagesRepo {
  constructor(private readonly db: Db) {}

  upsert(m: MessageRow): void {
    this.db
      .prepare(
        `INSERT INTO messages (chat_id, msg_id, sender_id, date, out, text, media_kind, reply_to_msg_id, edited_at, deleted_at, sent_via_paperplane)
         VALUES (@chatId, @msgId, @senderId, @date, @out, @text, @mediaKind, @replyToMsgId, @editedAt, @deletedAt, @sent)
         ON CONFLICT (chat_id, msg_id) DO UPDATE SET
           text = excluded.text, media_kind = excluded.media_kind, edited_at = excluded.edited_at,
           sent_via_paperplane = MAX(sent_via_paperplane, excluded.sent_via_paperplane)`,
      )
      .run({ ...m, out: m.out ? 1 : 0, sent: m.sentViaPaperplane ? 1 : 0 });
  }

  softDelete(chatId: number, msgIds: number[], nowSec: number): void {
    const stmt = this.db.prepare('UPDATE messages SET deleted_at = ? WHERE chat_id = ? AND msg_id = ? AND deleted_at IS NULL');
    this.db.transaction(() => msgIds.forEach((id) => stmt.run(nowSec, chatId, id)))();
  }

  /// Private chats and legacy groups share one account-wide id sequence, so
  /// Telegram reports their deletions without a chat id. Returns affected chats.
  softDeleteNonChannel(msgIds: number[], nowSec: number): number[] {
    const affected = new Set<number>();
    const find = this.db.prepare('SELECT chat_id FROM messages WHERE msg_id = ? AND chat_id > ? AND deleted_at IS NULL');
    const del = this.db.prepare('UPDATE messages SET deleted_at = ? WHERE msg_id = ? AND chat_id > ? AND deleted_at IS NULL');
    this.db.transaction(() => {
      for (const id of msgIds) {
        for (const r of find.all(id, CHANNEL_ID_BOUND) as { chat_id: number }[]) affected.add(r.chat_id);
        del.run(nowSec, id, CHANNEL_ID_BOUND);
      }
    })();
    return [...affected];
  }

  softDeleteAll(chatId: number, nowSec: number): void {
    this.db.prepare('UPDATE messages SET deleted_at = ? WHERE chat_id = ? AND deleted_at IS NULL').run(nowSec, chatId);
  }

  history(chatId: number, opts: { limit: number; beforeId?: number }): MessageRow[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND msg_id < ?
           ORDER BY msg_id DESC LIMIT ?`,
        )
        .all(chatId, opts.beforeId ?? Number.MAX_SAFE_INTEGER, opts.limit) as Record<string, unknown>[]
    ).map(rowToMessage);
  }

  latestAlive(chatId: number): MessageRow | null {
    const r = this.db
      .prepare('SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY msg_id DESC LIMIT 1')
      .get(chatId) as Record<string, unknown> | undefined;
    return r ? rowToMessage(r) : null;
  }

  oldestStored(chatId: number): number | null {
    const r = this.db.prepare('SELECT MIN(msg_id) AS m FROM messages WHERE chat_id = ?').get(chatId) as { m: number | null };
    return r.m;
  }

  search(query: string, opts: { chatId?: number; limit: number }): MessageRow[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const params: Record<string, unknown> = { fts, limit: opts.limit };
    if (opts.chatId !== undefined) params.chatId = opts.chatId;
    const sql = `SELECT m.* FROM messages_fts f JOIN messages m ON m.id = f.rowid
                 WHERE messages_fts MATCH @fts AND m.deleted_at IS NULL ${opts.chatId !== undefined ? 'AND m.chat_id = @chatId' : ''}
                 ORDER BY m.date DESC LIMIT @limit`;
    return (this.db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToMessage);
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n;
  }
}
