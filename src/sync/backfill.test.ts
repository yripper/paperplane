import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../testing/fake-gateway.js';
import { makeSink, makeStore, peer, type TestStore, tgMessage } from '../testing/fixtures.js';
import { backfillFullChats, backfillPage, type BackfillDeps, readHistory } from './backfill.js';

let store: TestStore;
let gateway: FakeGateway;
let deps: BackfillDeps;

beforeEach(() => {
  store = makeStore();
  gateway = new FakeGateway();
  deps = { gateway, chats: store.chats, messages: store.messages, cursors: store.cursors, sink: makeSink(store) };
  store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
  gateway.history.set(10, Array.from({ length: 5 }, (_, i) => tgMessage({ id: i + 1, date: i + 1 })));
});

describe('backfillPage', () => {
  it('pages backwards from the oldest stored message and marks completion', async () => {
    expect(await backfillPage(deps, 10, 3)).toEqual({ fetched: 3, complete: false });
    expect(store.cursors.get(10)).toEqual({ chatId: 10, oldestSyncedMsgId: 3, backfillComplete: false });
    expect(await backfillPage(deps, 10, 3)).toEqual({ fetched: 2, complete: true });
    expect(store.messages.count()).toBe(5);
    expect(await backfillPage(deps, 10, 3)).toEqual({ fetched: 0, complete: true });
  });
});

describe('readHistory', () => {
  it('serves from the store when it has enough', async () => {
    store.messages.upsert({
      chatId: 10, msgId: 5, senderId: 10, date: 5, out: false, text: 'x', mediaKind: null,
      replyToMsgId: null, editedAt: null, deletedAt: null, sentViaPaperplane: false,
    });
    expect((await readHistory(deps, 10, { limit: 1 })).map((m) => m.msgId)).toEqual([5]);
    expect(gateway.callsTo('getHistory')).toHaveLength(0);
  });

  it('fetches from Telegram when the store is short', async () => {
    expect((await readHistory(deps, 10, { limit: 4 })).map((m) => m.msgId)).toEqual([5, 4, 3, 2]);
  });

  it('reads muted chats straight from Telegram without storing them', async () => {
    const channel = peer({ id: -1001234567890, type: 'channel', title: 'Some Channel' });
    store.chats.ensure(channel, 'muted', 0);
    gateway.history.set(channel.id, [tgMessage({ id: 3, chat: channel })]);
    expect(await readHistory(deps, channel.id, { limit: 10 })).toHaveLength(1);
    expect(store.messages.history(channel.id, { limit: 10 })).toHaveLength(0);
  });

  it('backfills below beforeId when the store only holds newer messages', async () => {
    gateway.history.set(10, Array.from({ length: 200 }, (_, i) => tgMessage({ id: i + 1, date: i + 1 })));
    for (let id = 101; id <= 200; id++) {
      store.messages.upsert({
        chatId: 10, msgId: id, senderId: 10, date: id, out: false, text: 'x', mediaKind: null,
        replyToMsgId: null, editedAt: null, deletedAt: null, sentViaPaperplane: false,
      });
    }
    const rows = await readHistory(deps, 10, { limit: 10, beforeId: 101 });
    expect(rows.map((m) => m.msgId)).toEqual([100, 99, 98, 97, 96, 95, 94, 93, 92, 91]);
  });

  it('refresh re-fetches the page so stored text and senders are updated', async () => {
    for (const m of gateway.history.get(10) ?? []) deps.sink.onMessage({ ...m, text: 'stale', sender: null });
    gateway.history.set(10, [tgMessage({ id: 5, date: 5, text: '[docs](https://example.com)', sender: { id: 20, name: 'Bob Example', username: 'bob_example', isBot: false } })]);
    const rows = await readHistory(deps, 10, { limit: 1, refresh: true });
    expect(rows[0]).toMatchObject({ msgId: 5, text: '[docs](https://example.com)' });
    expect(store.senders.getMany([20]).size).toBe(1);
    expect(gateway.callsTo('getHistory')).toEqual([[10, { limit: 1, beforeId: undefined }]]);
  });

  it('throws NOT_FOUND for an unknown chat', async () => {
    await expect(readHistory(deps, 404, { limit: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('backfillFullChats', () => {
  it('fetches one page per incomplete full chat', async () => {
    store.chats.setWatchLevel(10, 'full', 0);
    const pages = await backfillFullChats({ ...deps, log: () => {} });
    expect(pages).toBe(1);
    expect(store.messages.count()).toBe(5);
  });
});
