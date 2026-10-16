import { beforeEach, describe, expect, it } from 'vitest';
import { ChatsRepo } from './chats-repo.js';
import { type Db, openDb } from './db.js';
import { LabelsRepo } from './labels-repo.js';
import { MessagesRepo } from './messages-repo.js';
import { listPending } from './pending-query.js';
import type { WatchLevel } from './types.js';

let db: Db;
let chats: ChatsRepo;
let messages: MessagesRepo;
let labels: LabelsRepo;

function chatWithIncoming(id: number, watch: WatchLevel, dates: number[]): void {
  chats.ensure({ id, type: 'user', title: `Chat ${id}`, username: null }, watch, 0);
  dates.forEach((date, i) => {
    messages.upsert({
      chatId: id, msgId: i + 1, senderId: id, date, out: false, text: 'x', mediaKind: null,
      replyToMsgId: null, editedAt: null, deletedAt: null, sentViaPaperplane: false,
    });
    chats.bumpTop(id, i + 1, false, date, 0);
  });
}

beforeEach(() => {
  db = openDb(':memory:');
  chats = new ChatsRepo(db);
  messages = new MessagesRepo(db);
  labels = new LabelsRepo(db);
});

describe('listPending', () => {
  it('lists full chats first, then by who has waited longest', () => {
    chatWithIncoming(1, 'normal', [100]);
    chatWithIncoming(2, 'normal', [50]);
    chatWithIncoming(3, 'full', [300]);
    expect(listPending(db, 1000, { limit: 10 }).map((p) => p.chat.id)).toEqual([3, 2, 1]);
  });

  it('measures waiting time from the oldest unanswered incoming message', () => {
    chats.ensure({ id: 1, type: 'user', title: 'Chat 1', username: null }, 'normal', 0);
    // incoming 100, my reply 200, then two unanswered incoming at 300 and 400
    [
      { msgId: 1, date: 100, out: false },
      { msgId: 2, date: 200, out: true },
      { msgId: 3, date: 300, out: false },
      { msgId: 4, date: 400, out: false },
    ].forEach(({ msgId, date, out }) => {
      messages.upsert({
        chatId: 1, msgId, senderId: out ? 0 : 1, date, out, text: 'x', mediaKind: null,
        replyToMsgId: null, editedAt: null, deletedAt: null, sentViaPaperplane: false,
      });
      chats.bumpTop(1, msgId, out, date, 0);
    });
    expect(listPending(db, 1000, { limit: 10 })[0]?.waitingSinceSec).toBe(300);
  });

  it('excludes muted chats, done chats and active snoozes', () => {
    chatWithIncoming(1, 'muted', [100]);
    chatWithIncoming(2, 'normal', [100]);
    chatWithIncoming(3, 'normal', [100]);
    chatWithIncoming(4, 'normal', [100]); // positive control: a bug excluding everything must fail
    labels.set({ chatId: 2, label: 'done', snoozeUntil: null, note: null, updatedAt: 0 });
    labels.set({ chatId: 3, label: 'snoozed', snoozeUntil: 5000, note: 'after lunch', updatedAt: 0 });
    expect(listPending(db, 1000, { limit: 10 }).map((p) => p.chat.id)).toEqual([4]);
  });

  it('brings back a chat whose snooze expired, with its label attached', () => {
    chatWithIncoming(1, 'normal', [100]);
    labels.set({ chatId: 1, label: 'snoozed', snoozeUntil: 500, note: null, updatedAt: 0 });
    const [item] = listPending(db, 1000, { limit: 10 });
    expect(item?.status).toBe('pending');
    expect(item?.label?.label).toBe('snoozed');
  });

  it('marks read-but-unanswered chats as seen', () => {
    chatWithIncoming(1, 'normal', [100]);
    chats.setReadInbox(1, 1, 0, 0);
    expect(listPending(db, 1000, { limit: 10 })[0]?.status).toBe('seen');
  });

  it('respects the limit', () => {
    chatWithIncoming(1, 'normal', [100]);
    chatWithIncoming(2, 'normal', [100]);
    expect(listPending(db, 1000, { limit: 1 })).toHaveLength(1);
  });
});
