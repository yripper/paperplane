import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { markRead, saveDraft, sendMessage } from './messaging.js';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps({ sendsPerMinute: 2 });
  t.store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
  t.store.chats.ensure({ id: 11, type: 'user', title: 'Bob Example', username: null }, 'normal', 0);
});

describe('sendMessage', () => {
  it('sends, stores the message as sent via Paperplane and clears pending', async () => {
    const sent = await sendMessage(t.deps, { chatId: 10, text: 'on it', replyTo: 3 });
    expect(t.gateway.callsTo('sendText')).toEqual([[10, 'on it', 3]]);
    expect(t.store.messages.history(10, { limit: 1 })[0]).toMatchObject({ msgId: sent.id, sentViaPaperplane: true, out: true });
    expect(t.store.chats.get(10)?.topMsgOut).toBe(true);
  });

  it('audits metadata only', async () => {
    await sendMessage(t.deps, { chatId: 10, text: 'secret words' });
    const [entry] = t.audit.recent(1);
    expect(entry).toMatchObject({ action: 'send_message', chatId: 10, outcome: 'ok' });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('enforces the per-chat gap', async () => {
    await sendMessage(t.deps, { chatId: 10, text: 'a' });
    await expect(sendMessage(t.deps, { chatId: 10, text: 'b' })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 1 });
  });

  it('enforces the global send limit', async () => {
    await sendMessage(t.deps, { chatId: 10, text: 'a' });
    await sendMessage(t.deps, { chatId: 11, text: 'b' });
    t.clock.ms += 2000;
    await expect(sendMessage(t.deps, { chatId: 10, text: 'c' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('rejects unknown chats before calling Telegram', async () => {
    await expect(sendMessage(t.deps, { chatId: 404, text: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
  });

  it('still returns the sent message when storing it fails', async () => {
    t.deps.sink.onMessage = (): void => {
      throw new Error('db down');
    };
    const sent = await sendMessage(t.deps, { chatId: 10, text: 'x' });
    expect(sent.text).toBe('x');
    expect(t.audit.recent(2).map((e) => [e.action, e.outcome])).toEqual([
      ['send_message.store', 'error'],
      ['send_message', 'ok'],
    ]);
  });

  it('audits failures and rethrows', async () => {
    t.gateway.failOn.set('sendText', new Error('boom'));
    await expect(sendMessage(t.deps, { chatId: 10, text: 'x' })).rejects.toThrow('boom');
    expect(t.audit.recent(1)[0]?.outcome).toBe('error');
  });
});

describe('saveDraft and markRead', () => {
  it('saves a Telegram draft', async () => {
    await saveDraft(t.deps, { chatId: 10, text: 'draft' });
    expect(t.gateway.callsTo('saveDraft')).toEqual([[10, 'draft']]);
  });

  it('marks read on Telegram and locally', async () => {
    t.store.chats.bumpTop(10, 5, false, 1, 0);
    t.store.chats.incrementUnread(10, 0);
    await markRead(t.deps, { chatId: 10 });
    expect(t.store.chats.get(10)).toMatchObject({ readInboxMaxId: 5, unreadCount: 0 });
  });
});
