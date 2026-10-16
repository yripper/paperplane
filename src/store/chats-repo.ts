import type { Db } from './db.js';
import type { ChatRow, ChatType, WatchLevel } from './types.js';

export interface ChatSeed {
  id: number;
  type: ChatType;
  title: string;
  username: string | null;
}

export interface DialogSnapshot {
  chatId: number;
  topMsgId: number;
  topMsgOut: boolean;
  topMsgDate: number;
  unreadCount: number;
  readInboxMaxId: number;
  readOutboxMaxId: number;
  archived: boolean;
  muted: boolean;
}

export interface ChatFilter {
  type?: ChatType;
  watchLevel?: WatchLevel;
  unreadOnly?: boolean;
  archived?: boolean;
  query?: string;
  limit: number;
  offset: number;
}

export function rowToChat(r: Record<string, unknown>): ChatRow {
  return {
    id: Number(r.id),
    type: r.type as ChatType,
    title: String(r.title),
    username: (r.username as string | null) ?? null,
    watchLevel: r.watch_level as WatchLevel,
    archived: r.archived === 1,
    muted: r.muted === 1,
    topMsgId: Number(r.top_msg_id),
    topMsgOut: r.top_msg_out === 1,
    topMsgDate: Number(r.top_msg_date),
    unreadCount: Number(r.unread_count),
    readInboxMaxId: Number(r.read_inbox_max_id),
    readOutboxMaxId: Number(r.read_outbox_max_id),
    updatedAt: Number(r.updated_at),
  };
}

const bool = (b: boolean): number => (b ? 1 : 0);

export class ChatsRepo {
  constructor(private readonly db: Db) {}

  /// Watch level is only set on first sight: after that it's my choice
  /// (set_watch_level), and a rename from Telegram must not reset it.
  ensure(seed: ChatSeed, defaultWatch: WatchLevel, nowSec: number): void {
    this.db
      .prepare(
        `INSERT INTO chats (id, type, title, username, watch_level, updated_at)
         VALUES (@id, @type, @title, @username, @watch, @now)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, username = excluded.username, type = excluded.type`,
      )
      .run({ ...seed, watch: defaultWatch, now: nowSec });
  }

  get(id: number): ChatRow | null {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToChat(r) : null;
  }

  list(f: ChatFilter): ChatRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: f.limit, offset: f.offset };
    if (f.type) {
      where.push('type = @type');
      params.type = f.type;
    }
    if (f.watchLevel) {
      where.push('watch_level = @watch');
      params.watch = f.watchLevel;
    }
    if (f.unreadOnly) where.push('unread_count > 0');
    if (f.archived !== undefined) {
      where.push('archived = @archived');
      params.archived = bool(f.archived);
    }
    if (f.query) {
      where.push("(title LIKE @q ESCAPE '\\' OR username LIKE @q ESCAPE '\\')");
      params.q = `%${f.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }
    const sql = `SELECT * FROM chats ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY top_msg_date DESC, id DESC LIMIT @limit OFFSET @offset`;
    return (this.db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToChat);
  }

  allIds(): number[] {
    return (this.db.prepare('SELECT id FROM chats').all() as { id: number }[]).map((r) => r.id);
  }

  /// Only forward, so a late duplicate (catch-up, sweep) can't roll the top back.
  bumpTop(chatId: number, msgId: number, out: boolean, date: number, nowSec: number): void {
    this.db
      .prepare(
        `UPDATE chats SET top_msg_id = @msgId, top_msg_out = @out, top_msg_date = @date, updated_at = @now
         WHERE id = @chatId AND @msgId >= top_msg_id`,
      )
      .run({ chatId, msgId, out: bool(out), date, now: nowSec });
  }

  /// Unconditional: used after the top message was deleted.
  setTop(chatId: number, msgId: number, out: boolean, date: number, nowSec: number): void {
    this.db
      .prepare('UPDATE chats SET top_msg_id = ?, top_msg_out = ?, top_msg_date = ?, updated_at = ? WHERE id = ?')
      .run(msgId, bool(out), date, nowSec, chatId);
  }

  incrementUnread(chatId: number, nowSec: number): void {
    this.db.prepare('UPDATE chats SET unread_count = unread_count + 1, updated_at = ? WHERE id = ?').run(nowSec, chatId);
  }

  setReadInbox(chatId: number, maxId: number, unreadCount: number, nowSec: number): void {
    this.db
      .prepare(
        `UPDATE chats SET read_inbox_max_id = @maxId, unread_count = @unread, updated_at = @now
         WHERE id = @chatId AND @maxId >= read_inbox_max_id`,
      )
      .run({ chatId, maxId, unread: unreadCount, now: nowSec });
  }

  setReadOutbox(chatId: number, maxId: number, nowSec: number): void {
    this.db
      .prepare('UPDATE chats SET read_outbox_max_id = MAX(read_outbox_max_id, ?), updated_at = ? WHERE id = ?')
      .run(maxId, nowSec, chatId);
  }

  /// Telegram's dialog list is authoritative for counters and flags. The top
  /// stays monotonic because a live update can land between the page fetch
  /// and this write; deletions lower the top through setTop instead.
  applySnapshot(s: DialogSnapshot, nowSec: number): void {
    this.db.transaction(() => {
      this.bumpTop(s.chatId, s.topMsgId, s.topMsgOut, s.topMsgDate, nowSec);
      this.db
        .prepare(
          `UPDATE chats SET unread_count = @unread, read_inbox_max_id = MAX(read_inbox_max_id, @inbox),
             read_outbox_max_id = MAX(read_outbox_max_id, @outbox), archived = @archived, muted = @muted, updated_at = @now
           WHERE id = @chatId`,
        )
        .run({
          chatId: s.chatId,
          unread: s.unreadCount,
          inbox: s.readInboxMaxId,
          outbox: s.readOutboxMaxId,
          archived: bool(s.archived),
          muted: bool(s.muted),
          now: nowSec,
        });
    })();
  }

  setWatchLevel(chatId: number, level: WatchLevel, nowSec: number): void {
    this.db.prepare('UPDATE chats SET watch_level = ?, updated_at = ? WHERE id = ?').run(level, nowSec, chatId);
  }

  setMuted(chatId: number, muted: boolean, nowSec: number): void {
    this.db.prepare('UPDATE chats SET muted = ?, updated_at = ? WHERE id = ?').run(bool(muted), nowSec, chatId);
  }

  setArchived(chatIds: number[], archived: boolean, nowSec: number): void {
    const stmt = this.db.prepare('UPDATE chats SET archived = ?, updated_at = ? WHERE id = ?');
    this.db.transaction(() => chatIds.forEach((id) => stmt.run(bool(archived), nowSec, id)))();
  }

  /// The chat no longer exists for me (deleted, left, or gone from Telegram).
  purge(chatId: number): void {
    this.db.transaction(() => {
      for (const table of ['messages', 'chat_labels', 'sync_cursors']) {
        this.db.prepare(`DELETE FROM ${table} WHERE chat_id = ?`).run(chatId);
      }
      this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
    })();
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM chats').get() as { n: number }).n;
  }
}
