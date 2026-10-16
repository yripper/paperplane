import type { Db } from './db.js';
import type { ChatLabel, LabelKind } from './types.js';

export function rowToLabel(r: Record<string, unknown>): ChatLabel {
  return {
    chatId: Number(r.chat_id),
    label: r.label as LabelKind,
    snoozeUntil: r.snooze_until === null ? null : Number(r.snooze_until),
    note: (r.note as string | null) ?? null,
    updatedAt: Number(r.updated_at),
  };
}

export class LabelsRepo {
  constructor(private readonly db: Db) {}

  set(l: ChatLabel): void {
    this.db
      .prepare(
        `INSERT INTO chat_labels (chat_id, label, snooze_until, note, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET label = excluded.label, snooze_until = excluded.snooze_until,
           note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(l.chatId, l.label, l.snoozeUntil, l.note, l.updatedAt);
  }

  get(chatId: number): ChatLabel | null {
    const r = this.db.prepare('SELECT * FROM chat_labels WHERE chat_id = ?').get(chatId) as Record<string, unknown> | undefined;
    return r ? rowToLabel(r) : null;
  }

  clear(chatId: number): void {
    this.db.prepare('DELETE FROM chat_labels WHERE chat_id = ?').run(chatId);
  }
}
