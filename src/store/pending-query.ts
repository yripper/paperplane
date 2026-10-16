import { effectiveStatus } from '../domain/pending.js';
import { rowToChat } from './chats-repo.js';
import type { Db } from './db.js';
import { rowToLabel } from './labels-repo.js';
import type { ChatLabel, ChatRow } from './types.js';

export interface PendingItem {
  chat: ChatRow;
  status: 'pending' | 'seen';
  waitingSinceSec: number;
  label: ChatLabel | null;
}

// Telegram's service account (login codes, security notices) never needs a reply.
const TELEGRAM_SERVICE_ID = 777000;

// Groups only count when I put them on full watch: in most groups the last
// message not being mine is normal, not a reply I owe. Channels never take replies.

// waiting_since = oldest incoming message after my last reply; falls back to
// the top message date when history isn't stored (e.g. not backfilled yet).
const SQL = `
  SELECT c.*, l.chat_id AS l_chat_id, l.label AS l_label, l.snooze_until AS l_snooze_until,
         l.note AS l_note, l.updated_at AS l_updated_at,
         COALESCE((
           SELECT MIN(m.date) FROM messages m
           WHERE m.chat_id = c.id AND m.out = 0 AND m.deleted_at IS NULL
             AND m.msg_id > COALESCE((SELECT MAX(o.msg_id) FROM messages o
                                      WHERE o.chat_id = c.id AND o.out = 1 AND o.deleted_at IS NULL), 0)
         ), c.top_msg_date) AS waiting_since
  FROM chats c LEFT JOIN chat_labels l ON l.chat_id = c.id
  WHERE c.watch_level != 'muted' AND c.top_msg_out = 0 AND c.top_msg_id > 0
    AND c.id != ${TELEGRAM_SERVICE_ID}
    AND (c.type = 'user' OR (c.type IN ('group', 'supergroup') AND c.watch_level = 'full'))`;

export function listPending(db: Db, nowSec: number, opts: { limit: number }): PendingItem[] {
  const items: PendingItem[] = [];
  for (const r of db.prepare(SQL).all() as Record<string, unknown>[]) {
    const chat = rowToChat(r);
    const label =
      r.l_chat_id === null
        ? null
        : rowToLabel({ chat_id: r.l_chat_id, label: r.l_label, snooze_until: r.l_snooze_until, note: r.l_note, updated_at: r.l_updated_at });
    const status = effectiveStatus(chat, label, nowSec);
    if (status === 'pending' || status === 'seen') {
      items.push({ chat, status, waitingSinceSec: Number(r.waiting_since), label });
    }
  }
  // Newest incoming first: oldest-first buried today's chats under years-old
  // read-and-ignored ones. Full-watch chats stay on top however old they are.
  items.sort(
    (a, b) =>
      Number(b.chat.watchLevel === 'full') - Number(a.chat.watchLevel === 'full') || b.chat.topMsgDate - a.chat.topMsgDate,
  );
  return items.slice(0, opts.limit);
}
