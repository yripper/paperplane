import { AppError } from '../domain/errors.js';
import { labelSurvivesIncoming } from '../domain/pending.js';
import type { ChatsRepo } from '../store/chats-repo.js';
import type { Db } from '../store/db.js';
import type { LabelsRepo } from '../store/labels-repo.js';
import type { MessagesRepo } from '../store/messages-repo.js';
import type { SendersRepo } from '../store/senders-repo.js';
import type { ChatRow, ChatType, MessageRow, WatchLevel } from '../store/types.js';
import type { TgDeleteEvent, TgMessage, TgPeer, TgReadEvent } from '../telegram/types.js';

export interface SinkDeps {
  db: Db;
  chats: ChatsRepo;
  messages: MessagesRepo;
  labels: LabelsRepo;
  senders: SendersRepo;
  watchDefaults: Record<ChatType, WatchLevel>;
  /** Unix seconds. */
  now: () => number;
}

export function toMessageRow(m: TgMessage, sentViaPaperplane: boolean): MessageRow {
  return {
    chatId: m.chat.id,
    msgId: m.id,
    senderId: m.sender?.id ?? null,
    date: m.date,
    out: m.out,
    text: m.text,
    mediaKind: m.mediaKind,
    replyToMsgId: m.replyToMsgId,
    editedAt: m.editedAt,
    deletedAt: null,
    sentViaPaperplane,
  };
}

/// The only writer of synced state. Every method is idempotent because live
/// updates, catch-up and the sweep all deliver the same messages.
export class UpdateSink {
  constructor(private readonly d: SinkDeps) {}

  ensureChat(p: TgPeer, mutedInTelegram = false): ChatRow {
    const watch = mutedInTelegram ? 'muted' : this.d.watchDefaults[p.type];
    this.d.chats.ensure({ id: p.id, type: p.type, title: p.title, username: p.username }, watch, this.d.now());
    const row = this.d.chats.get(p.id);
    if (!row) throw new AppError('INTERNAL', `chat ${p.id} missing right after ensure`);
    return row;
  }

  onMessage(m: TgMessage, opts: { live?: boolean; sentViaPaperplane?: boolean } = {}): void {
    const now = this.d.now();
    this.d.db.transaction(() => {
      const before = this.ensureChat(m.chat);
      if (before.watchLevel !== 'muted') this.store(m, opts.sentViaPaperplane ?? false, now);
      const advanced = m.id > before.topMsgId;
      this.d.chats.bumpTop(m.chat.id, m.id, m.out, m.date, now);
      if (!advanced || m.out) return;
      // Only live updates count as unread; sweep snapshots carry Telegram's own count.
      if (opts.live) this.d.chats.incrementUnread(m.chat.id, now);
      const label = this.d.labels.get(m.chat.id);
      if (label && !labelSurvivesIncoming(label)) this.d.labels.clear(m.chat.id);
    })();
  }

  onEdit(m: TgMessage): void {
    this.d.db.transaction(() => {
      const chat = this.ensureChat(m.chat);
      if (chat.watchLevel !== 'muted') this.store(m, false, this.d.now());
    })();
  }

  private store(m: TgMessage, sentViaPaperplane: boolean, now: number): void {
    this.d.messages.upsert(toMessageRow(m, sentViaPaperplane));
    if (m.sender) this.d.senders.upsert(m.sender, now);
  }

  onDelete(e: TgDeleteEvent): void {
    const now = this.d.now();
    this.d.db.transaction(() => {
      let affected: number[];
      if (e.channelId !== null) {
        this.d.messages.softDelete(e.channelId, e.messageIds, now);
        affected = [e.channelId];
      } else {
        affected = this.d.messages.softDeleteNonChannel(e.messageIds, now);
      }
      for (const chatId of affected) {
        const chat = this.d.chats.get(chatId);
        if (!chat || !e.messageIds.includes(chat.topMsgId)) continue;
        const latest = this.d.messages.latestAlive(chatId);
        this.d.chats.setTop(chatId, latest?.msgId ?? 0, latest?.out ?? false, latest?.date ?? 0, now);
      }
    })();
  }

  onRead(e: TgReadEvent): void {
    if (!this.d.chats.get(e.chatId)) return; // the next sweep creates it with full state
    const now = this.d.now();
    if (e.isOutbox) this.d.chats.setReadOutbox(e.chatId, e.maxReadId, now);
    else this.d.chats.setReadInbox(e.chatId, e.maxReadId, e.unreadCount, now);
  }
}
