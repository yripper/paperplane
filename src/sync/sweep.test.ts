import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../testing/fake-gateway.js';
import { makeSink, makeStore, peer, type TestStore, tgDialog, tgMessage } from '../testing/fixtures.js';
import { AppError } from '../domain/errors.js';
import { runSweep, type SweepDeps } from './sweep.js';

let store: TestStore;
let gateway: FakeGateway;
let deps: SweepDeps;
const logs: string[] = [];

beforeEach(() => {
  store = makeStore();
  gateway = new FakeGateway();
  logs.length = 0;
  deps = { gateway, chats: store.chats, sink: makeSink(store), now: () => 1000, log: (l) => logs.push(l) };
});

describe('runSweep', () => {
  it('stores the top message on first sight without fetching history', async () => {
    gateway.dialogs = [tgDialog({ topMessage: tgMessage({ id: 7 }), unreadCount: 1 })];
    const report = await runSweep(deps);
    expect(report).toMatchObject({ dialogs: 1, deltas: 0, complete: true });
    expect(gateway.callsTo('getHistory')).toHaveLength(0);
    expect(store.chats.get(10)).toMatchObject({ topMsgId: 7, unreadCount: 1 });
  });

  it('fetches only the delta when the top advanced', async () => {
    store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
    store.chats.bumpTop(10, 5, false, 50, 0);
    gateway.history.set(10, [6, 7, 8].map((id) => tgMessage({ id, date: id * 10 })));
    gateway.dialogs = [tgDialog({ topMessage: tgMessage({ id: 8, date: 80 }) })];
    const report = await runSweep(deps);
    expect(gateway.callsTo('getHistory')).toEqual([[10, { limit: 100, afterId: 5 }]]);
    expect(store.messages.history(10, { limit: 10 }).map((m) => m.msgId)).toEqual([8, 7, 6]);
    expect(report.deltas).toBe(1);
  });

  it('never fetches history for muted chats', async () => {
    const channel = peer({ id: -1001234567890, type: 'channel', title: 'Some Channel' });
    store.chats.ensure(channel, 'muted', 0);
    store.chats.bumpTop(channel.id, 5, false, 50, 0);
    gateway.dialogs = [tgDialog({ chat: channel, topMessage: tgMessage({ id: 9, chat: channel }) })];
    await runSweep(deps);
    expect(gateway.callsTo('getHistory')).toHaveLength(0);
    expect(store.chats.get(channel.id)?.topMsgId).toBe(9);
  });

  it('applies Telegram counters and flags from the snapshot', async () => {
    gateway.dialogs = [tgDialog({ unreadCount: 4, archived: true, muted: true, readInboxMaxId: 0 })];
    await runSweep(deps);
    expect(store.chats.get(10)).toMatchObject({ unreadCount: 4, archived: true, muted: true, watchLevel: 'muted' });
  });

  it('keeps going when one dialog fails', async () => {
    const bob = peer({ id: 11, title: 'Bob Example' });
    for (const id of [10, 11]) {
      store.chats.ensure({ id, type: 'user', title: 'x', username: null }, 'normal', 0);
      store.chats.bumpTop(id, 1, false, 1, 0);
    }
    gateway.failHistoryFor.add(10);
    gateway.history.set(11, [tgMessage({ id: 2, chat: bob })]);
    gateway.dialogs = [
      tgDialog({ topMessage: tgMessage({ id: 2 }) }),
      tgDialog({ chat: bob, topMessage: tgMessage({ id: 2, chat: bob }) }),
    ];
    const report = await runSweep(deps);
    expect(report.failures).toBe(1);
    expect(store.messages.history(11, { limit: 10 })).toHaveLength(1);
    expect(logs.some((l) => l.includes('dialog 10'))).toBe(true);
  });

  it('purges chats missing from a complete sweep', async () => {
    store.chats.ensure({ id: 99, type: 'user', title: 'Deleted On Phone', username: null }, 'normal', 0);
    gateway.dialogs = [tgDialog()];
    const report = await runSweep(deps);
    expect(report.purged).toBe(1);
    expect(store.chats.get(99)).toBeNull();
  });

  it('does not purge when iteration fails', async () => {
    store.chats.ensure({ id: 99, type: 'user', title: 'Not Reached', username: null }, 'normal', 0);
    gateway.dialogs = [tgDialog(), tgDialog({ chat: peer({ id: 12 }) })];
    gateway.failDialogsAfter = 1;
    const report = await runSweep(deps);
    expect(report.complete).toBe(false);
    expect(report.iterationError).toBe('INTERNAL');
    expect(report.purged).toBe(0);
    expect(store.chats.get(99)).not.toBeNull();
  });

  it('does not purge a chat touched by a live update during the sweep', async () => {
    store.chats.ensure({ id: 99, type: 'user', title: 'Stale Missing', username: null }, 'normal', 0);
    const live = peer({ id: 55, title: 'Live Newcomer' });
    gateway.dialogs = [tgDialog()];
    // Clock is 1000 for both the sweep and the sink, i.e. at/after sweep start.
    gateway.afterDialog = () => deps.sink.onMessage(tgMessage({ id: 1, chat: live }), { live: true });
    const report = await runSweep(deps);
    expect(report.complete).toBe(true);
    expect(store.chats.get(55)).not.toBeNull();
    expect(store.chats.get(99)).toBeNull();
    expect(report.purged).toBe(1);
  });

  it('reports AUTH_REQUIRED from dialog iteration without purging', async () => {
    store.chats.ensure({ id: 99, type: 'user', title: 'Kept', username: null }, 'normal', 0);
    gateway.dialogs = [tgDialog()];
    gateway.iterationError = new AppError('AUTH_REQUIRED', 'session revoked');
    const report = await runSweep(deps);
    expect(report).toMatchObject({ complete: false, iterationError: 'AUTH_REQUIRED', purged: 0 });
    expect(store.chats.get(99)).not.toBeNull();
  });

  it('fills a delta larger than one page completely', async () => {
    store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
    store.chats.bumpTop(10, 5, false, 5, 0);
    gateway.history.set(10, Array.from({ length: 250 }, (_, i) => tgMessage({ id: i + 6, date: i + 6 })));
    gateway.dialogs = [tgDialog({ topMessage: tgMessage({ id: 255, date: 255 }) })];
    const report = await runSweep(deps);
    expect(report.deltas).toBe(1);
    expect(gateway.callsTo('getHistory')).toHaveLength(3);
    expect(store.messages.count()).toBe(250);
    expect(store.messages.oldestStored(10)).toBe(6);
    expect(logs.some((l) => l.includes('delta gap left'))).toBe(false);
  });

  it('logs the residual gap when the delta exceeds the page cap', async () => {
    store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
    store.chats.bumpTop(10, 5, false, 5, 0);
    gateway.history.set(10, Array.from({ length: 1200 }, (_, i) => tgMessage({ id: i + 6, date: i + 6 })));
    gateway.dialogs = [tgDialog({ topMessage: tgMessage({ id: 1205, date: 1205 }) })];
    await runSweep(deps);
    expect(gateway.callsTo('getHistory')).toHaveLength(10);
    expect(store.messages.count()).toBe(1000);
    expect(logs.some((l) => l.includes('chat 10: delta gap left'))).toBe(true);
  });
});
