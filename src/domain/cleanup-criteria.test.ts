import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../store/types.js';
import { cleanupActionFor, selectForCleanup } from './cleanup-criteria.js';

const DAY = 86_400;
const chat = (over: Partial<ChatRow>): ChatRow => ({
  id: 1, type: 'user', title: 'x', username: null, watchLevel: 'normal', archived: false, muted: false,
  topMsgId: 1, topMsgOut: false, topMsgDate: 0, unreadCount: 0, readInboxMaxId: 0, readOutboxMaxId: 0, updatedAt: 0,
  ...over,
});

describe('selectForCleanup', () => {
  const now = 1000 * DAY;

  it('selects chats inactive for at least N days', () => {
    const chats = [chat({ id: 1, topMsgDate: now - 200 * DAY }), chat({ id: 2, topMsgDate: now - 10 * DAY })];
    expect(selectForCleanup(chats, { inactiveDays: 180 }, now).map((c) => c.id)).toEqual([1]);
  });

  it('never selects full-watch chats', () => {
    expect(selectForCleanup([chat({ watchLevel: 'full', topMsgDate: 0 })], { inactiveDays: 1 }, now)).toEqual([]);
  });

  it('combines criteria with AND', () => {
    const chats = [
      chat({ id: 1, type: 'channel', unreadCount: 500, muted: true }),
      chat({ id: 2, type: 'channel', unreadCount: 3, muted: true }),
      chat({ id: 3, type: 'user', unreadCount: 500, muted: true }),
    ];
    expect(selectForCleanup(chats, { types: ['channel'], minUnread: 100, mutedOnly: true }, now).map((c) => c.id)).toEqual([1]);
  });

  it('filters archived chats when asked', () => {
    const chats = [chat({ id: 1, archived: true }), chat({ id: 2 })];
    expect(selectForCleanup(chats, { archivedOnly: true }, now).map((c) => c.id)).toEqual([1]);
  });
});

describe('cleanupActionFor', () => {
  it('deletes private chats and leaves groups and channels', () => {
    expect(cleanupActionFor('user', 'remove')).toBe('delete');
    expect(cleanupActionFor('bot', 'remove')).toBe('delete');
    expect(cleanupActionFor('group', 'remove')).toBe('leave');
    expect(cleanupActionFor('channel', 'remove')).toBe('leave');
    expect(cleanupActionFor('channel', 'archive')).toBe('archive');
  });
});
