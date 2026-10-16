import { beforeEach, describe, expect, it } from 'vitest';
import { autoStatus } from '../domain/pending.js';
import { makeSink, makeStore, peer, type TestStore, tgMessage } from '../testing/fixtures.js';
import type { UpdateSink } from './update-sink.js';

let store: TestStore;
let sink: UpdateSink;

beforeEach(() => {
  store = makeStore();
  sink = makeSink(store);
});

const status = (chatId: number): string => {
  const chat = store.chats.get(chatId);
  if (!chat) throw new Error('no chat');
  return autoStatus(chat);
};

describe('UpdateSink.onMessage', () => {
  it('stores who sent the message', () => {
    sink.onMessage(tgMessage({ id: 5, chat: peer({ id: 30, type: 'supergroup', title: 'Group' }), sender: { id: 20, name: 'Bob Example', username: 'bob_example', isBot: false } }));
    expect(store.senders.getMany([20]).get(20)).toMatchObject({ name: 'Bob Example', username: 'bob_example', updatedAt: 1000 });
  });

  it('stores no sender for muted chats', () => {
    store.chats.ensure({ id: 30, type: 'supergroup', title: 'Group', username: null }, 'muted', 0);
    sink.onMessage(tgMessage({ id: 5, chat: peer({ id: 30, type: 'supergroup', title: 'Group' }), sender: { id: 20, name: 'Bob Example', username: null, isBot: false } }));
    expect(store.senders.getMany([20]).size).toBe(0);
  });

  it('stores an incoming live message, bumps the top and counts it unread', () => {
    sink.onMessage(tgMessage({ id: 5 }), { live: true });
    expect(store.messages.count()).toBe(1);
    expect(store.chats.get(10)).toMatchObject({ topMsgId: 5, unreadCount: 1, watchLevel: 'normal' });
    expect(status(10)).toBe('pending');
  });

  it('clears pending when I reply from another device', () => {
    sink.onMessage(tgMessage({ id: 5 }), { live: true });
    sink.onMessage(tgMessage({ id: 6, out: true, sender: { id: 1, name: 'Me Example', username: null, isBot: false } }), { live: true });
    expect(status(10)).toBe('clear');
  });

  it('does not double count a duplicate delivery (catch-up, sweep)', () => {
    sink.onMessage(tgMessage({ id: 5 }), { live: true });
    sink.onMessage(tgMessage({ id: 5 }), { live: true });
    expect(store.chats.get(10)?.unreadCount).toBe(1);
  });

  it('resets done and waiting labels on a new incoming message but keeps snoozes', () => {
    sink.onMessage(tgMessage({ id: 1 }), { live: true });
    store.labels.set({ chatId: 10, label: 'done', snoozeUntil: null, note: null, updatedAt: 0 });
    sink.onMessage(tgMessage({ id: 2 }), { live: true });
    expect(store.labels.get(10)).toBeNull();

    store.labels.set({ chatId: 10, label: 'snoozed', snoozeUntil: 9999, note: null, updatedAt: 0 });
    sink.onMessage(tgMessage({ id: 3 }), { live: true });
    expect(store.labels.get(10)?.label).toBe('snoozed');
  });

  it('keeps a waiting label when the new message is mine', () => {
    sink.onMessage(tgMessage({ id: 1 }), { live: true });
    store.labels.set({ chatId: 10, label: 'waiting', snoozeUntil: null, note: null, updatedAt: 0 });
    sink.onMessage(tgMessage({ id: 2, out: true }), { live: true });
    expect(store.labels.get(10)?.label).toBe('waiting');
  });

  it('defaults channels to muted and stores only metadata for muted chats', () => {
    const channel = peer({ id: -1001234567890, type: 'channel', title: 'Some Channel' });
    sink.onMessage(tgMessage({ id: 9, chat: channel }), { live: true });
    expect(store.chats.get(channel.id)).toMatchObject({ watchLevel: 'muted', topMsgId: 9 });
    expect(store.messages.count()).toBe(0);
  });

  it('stores media-only messages with empty text', () => {
    sink.onMessage(tgMessage({ id: 4, text: '', mediaKind: 'photo' }), { live: true });
    expect(store.messages.history(10, { limit: 1 })[0]).toMatchObject({ text: '', mediaKind: 'photo' });
  });

  it('records messages sent through Paperplane', () => {
    sink.onMessage(tgMessage({ id: 4, out: true }), { live: true, sentViaPaperplane: true });
    expect(store.messages.history(10, { limit: 1 })[0]?.sentViaPaperplane).toBe(true);
  });
});

describe('UpdateSink.onEdit', () => {
  it('updates the stored text without touching unread', () => {
    sink.onMessage(tgMessage({ id: 4, text: 'before' }), { live: true });
    sink.onEdit(tgMessage({ id: 4, text: 'after', editedAt: 200 }));
    expect(store.messages.history(10, { limit: 1 })[0]).toMatchObject({ text: 'after', editedAt: 200 });
    expect(store.chats.get(10)?.unreadCount).toBe(1);
  });
});

describe('UpdateSink.onDelete', () => {
  it('recomputes the top when the top message is deleted', () => {
    sink.onMessage(tgMessage({ id: 1, date: 10 }), { live: true });
    sink.onMessage(tgMessage({ id: 2, out: true, date: 20 }), { live: true });
    sink.onDelete({ channelId: null, messageIds: [2] });
    expect(store.chats.get(10)).toMatchObject({ topMsgId: 1, topMsgOut: false, topMsgDate: 10 });
    expect(status(10)).toBe('pending');
  });

  it('deletes channel messages by channel id', () => {
    const group = peer({ id: -1001234567890, type: 'supergroup', title: 'Team' });
    sink.onMessage(tgMessage({ id: 1, chat: group }), { live: true });
    sink.onDelete({ channelId: group.id, messageIds: [1] });
    expect(store.messages.history(group.id, { limit: 10 })).toHaveLength(0);
  });
});

describe('UpdateSink.onRead', () => {
  it('marks a chat seen when I read it on my phone', () => {
    sink.onMessage(tgMessage({ id: 3 }), { live: true });
    sink.onRead({ chatId: 10, maxReadId: 3, isOutbox: false, unreadCount: 0 });
    expect(status(10)).toBe('seen');
    expect(store.chats.get(10)?.unreadCount).toBe(0);
  });

  it('tracks when they read my messages', () => {
    sink.onMessage(tgMessage({ id: 3, out: true }), { live: true });
    sink.onRead({ chatId: 10, maxReadId: 3, isOutbox: true, unreadCount: 0 });
    expect(store.chats.get(10)?.readOutboxMaxId).toBe(3);
  });

  it('ignores reads for chats it has never seen', () => {
    expect(() => sink.onRead({ chatId: 77, maxReadId: 1, isOutbox: false, unreadCount: 0 })).not.toThrow();
    expect(store.chats.get(77)).toBeNull();
  });
});
