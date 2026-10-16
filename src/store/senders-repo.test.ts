import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { SendersRepo } from './senders-repo.js';

let senders: SendersRepo;

beforeEach(() => {
  senders = new SendersRepo(openDb(':memory:'));
});

describe('SendersRepo', () => {
  it('returns stored senders by id and skips unknown ones', () => {
    senders.upsert({ id: 20, name: 'Bob Example', username: 'bob_example', isBot: false }, 100);
    const found = senders.getMany([20, 21]);
    expect([...found.keys()]).toEqual([20]);
    expect(found.get(20)).toEqual({ id: 20, name: 'Bob Example', username: 'bob_example', isBot: false, updatedAt: 100 });
  });

  it('keeps the latest name and username after a rename', () => {
    senders.upsert({ id: 20, name: 'Bob Example', username: 'bob_example', isBot: false }, 100);
    senders.upsert({ id: 20, name: 'Robert Example', username: null, isBot: false }, 200);
    expect(senders.getMany([20]).get(20)).toMatchObject({ name: 'Robert Example', username: null, updatedAt: 200 });
  });

  it('returns an empty map for no ids', () => {
    expect(senders.getMany([]).size).toBe(0);
  });
});
