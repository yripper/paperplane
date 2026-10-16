import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { blockUser, deleteChat, leaveChat } from './destructive.js';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps({ destructivePerMinute: 1 });
  t.store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
  t.store.chats.ensure({ id: -1001234567890, type: 'supergroup', title: 'Team', username: null }, 'normal', 0);
});

describe('deleteChat', () => {
  it('deletes for me and purges the chat locally', async () => {
    await deleteChat(t.deps, { chatId: 10, mode: 'delete' });
    expect(t.gateway.callsTo('deleteChat')).toEqual([[10, 'delete']]);
    expect(t.store.chats.get(10)).toBeNull();
  });

  it('clear keeps the chat but empties its history', async () => {
    t.deps.sink.onMessage({
      id: 1, chat: { id: 10, type: 'user', title: 'Alice Example', username: null }, senderId: 10, date: 1,
      out: false, text: 'x', mediaKind: null, replyToMsgId: null, editedAt: null,
    });
    await deleteChat(t.deps, { chatId: 10, mode: 'clear' });
    expect(t.store.chats.get(10)?.topMsgId).toBe(0);
    expect(t.store.messages.history(10, { limit: 10 })).toHaveLength(0);
  });

  it('refuses revoke without the exact chat title, before calling Telegram', async () => {
    await expect(deleteChat(t.deps, { chatId: 10, mode: 'revoke' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(deleteChat(t.deps, { chatId: 10, mode: 'revoke', confirmTitle: 'alice example' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(t.gateway.callsTo('deleteChat')).toHaveLength(0);
  });

  it('allows revoke with the exact title', async () => {
    await deleteChat(t.deps, { chatId: 10, mode: 'revoke', confirmTitle: 'Alice Example' });
    expect(t.gateway.callsTo('deleteChat')).toEqual([[10, 'revoke']]);
  });

  it('points channels and supergroups to leave_chat', async () => {
    await expect(deleteChat(t.deps, { chatId: -1001234567890, mode: 'delete' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('enforces the destructive rate limit', async () => {
    await deleteChat(t.deps, { chatId: 10, mode: 'delete' });
    await expect(leaveChat(t.deps, { chatId: -1001234567890 })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('leaveChat and blockUser', () => {
  it('leaves groups and purges them locally', async () => {
    await leaveChat(t.deps, { chatId: -1001234567890 });
    expect(t.store.chats.get(-1001234567890)).toBeNull();
  });

  it('points private chats to delete_chat', async () => {
    await expect(leaveChat(t.deps, { chatId: 10 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('blocks a user', async () => {
    await blockUser(t.deps, { userId: 10 });
    expect(t.gateway.callsTo('blockUser')).toEqual([[10]]);
  });
});
