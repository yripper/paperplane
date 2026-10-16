import type { Db } from './db.js';

export interface SyncCursor {
  chatId: number;
  oldestSyncedMsgId: number | null;
  backfillComplete: boolean;
}

export class CursorsRepo {
  constructor(private readonly db: Db) {}

  get(chatId: number): SyncCursor | null {
    const r = this.db.prepare('SELECT * FROM sync_cursors WHERE chat_id = ?').get(chatId) as
      | { chat_id: number; oldest_synced_msg_id: number | null; backfill_complete: number }
      | undefined;
    return r ? { chatId: r.chat_id, oldestSyncedMsgId: r.oldest_synced_msg_id, backfillComplete: r.backfill_complete === 1 } : null;
  }

  set(c: SyncCursor): void {
    this.db
      .prepare(
        `INSERT INTO sync_cursors (chat_id, oldest_synced_msg_id, backfill_complete) VALUES (?, ?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET oldest_synced_msg_id = excluded.oldest_synced_msg_id,
           backfill_complete = excluded.backfill_complete`,
      )
      .run(c.chatId, c.oldestSyncedMsgId, c.backfillComplete ? 1 : 0);
  }
}
