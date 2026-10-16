import { beforeEach, describe, expect, it } from 'vitest';
import { SendersRepo } from '../store/senders-repo.js';
import { FakeGateway } from '../testing/fake-gateway.js';
import { makeStore, type TestStore } from '../testing/fixtures.js';
import { resolveSenders } from './senders.js';

let gateway: FakeGateway;
let senders: SendersRepo;
let store: TestStore;

beforeEach(() => {
  gateway = new FakeGateway();
  store = makeStore();
  senders = new SendersRepo(store.db);
});

const resolve = (ids: (number | null)[]) => resolveSenders({ gateway, senders, chats: store.chats, now: () => 500 }, ids);

describe('resolveSenders', () => {
  it('answers known senders from the store without calling Telegram', async () => {
    senders.upsert({ id: 20, name: 'Bob Example', username: 'bob_example', isBot: false }, 100);
    const found = await resolve([20, 20, null]);
    expect(found.get(20)?.username).toBe('bob_example');
    expect(gateway.callsTo('getUsers')).toHaveLength(0);
  });

  it('fetches unknown users once, in one batch, and stores them', async () => {
    gateway.users.set(21, { id: 21, name: 'Carol Example', username: 'carol_example', isBot: false });
    gateway.users.set(22, { id: 22, name: 'Dan Example', username: null, isBot: false });
    const found = await resolve([21, 22, 21]);
    expect(gateway.callsTo('getUsers')).toEqual([[[21, 22]]]);
    expect(found.get(22)?.name).toBe('Dan Example');
    expect(senders.getMany([21, 22]).size).toBe(2);
  });

  it('names a chat posting as itself from the chats table, without asking Telegram', async () => {
    store.chats.ensure({ id: -1001234, type: 'supergroup', title: 'Example Group', username: 'example_group' }, 'normal', 0);
    const found = await resolve([-1001234, -1009999]);
    expect(found.get(-1001234)).toMatchObject({ name: 'Example Group', username: 'example_group' });
    expect(found.has(-1009999)).toBe(false);
    expect(gateway.callsTo('getUsers')).toHaveLength(0);
  });

  it('returns what it knows when Telegram fails', async () => {
    senders.upsert({ id: 20, name: 'Bob Example', username: null, isBot: false }, 100);
    gateway.failOn.set('getUsers', new Error('offline'));
    const found = await resolve([20, 21]);
    expect([...found.keys()]).toEqual([20]);
  });
});
