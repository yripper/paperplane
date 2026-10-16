import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { MessagesRepo } from './messages-repo.js';
import type { MessageRow } from './types.js';

const msg = (over: Partial<MessageRow> = {}): MessageRow => ({
  chatId: 10,
  msgId: 1,
  senderId: 10,
  date: 100,
  out: false,
  text: 'hello there',
  mediaKind: null,
  replyToMsgId: null,
  editedAt: null,
  deletedAt: null,
  sentViaPaperplane: false,
  ...over,
});

describe('MessagesRepo', () => {
  let repo: MessagesRepo;
  beforeEach(() => {
    repo = new MessagesRepo(openDb(':memory:'));
  });

  it('upsert is idempotent', () => {
    repo.upsert(msg());
    repo.upsert(msg());
    expect(repo.count()).toBe(1);
  });

  it('upsert applies edits and keeps search in sync', () => {
    repo.upsert(msg());
    repo.upsert(msg({ text: 'edited words', editedAt: 200 }));
    expect(repo.search('edited', { limit: 10 })).toHaveLength(1);
    expect(repo.search('hello', { limit: 10 })).toHaveLength(0);
  });

  it('never downgrades sentViaPaperplane', () => {
    repo.upsert(msg({ out: true, sentViaPaperplane: true }));
    repo.upsert(msg({ out: true, sentViaPaperplane: false }));
    expect(repo.history(10, { limit: 10 })[0]?.sentViaPaperplane).toBe(true);
  });

  it('history returns newest first, paginates with beforeId and hides deleted', () => {
    for (let i = 1; i <= 5; i++) repo.upsert(msg({ msgId: i, date: i }));
    repo.softDelete(10, [5], 999);
    expect(repo.history(10, { limit: 2 }).map((m) => m.msgId)).toEqual([4, 3]);
    expect(repo.history(10, { limit: 10, beforeId: 3 }).map((m) => m.msgId)).toEqual([2, 1]);
  });

  it('softDeleteNonChannel leaves channel messages with the same id alone', () => {
    repo.upsert(msg({ chatId: 10, msgId: 7 }));
    repo.upsert(msg({ chatId: -1001234567890, msgId: 7 }));
    expect(repo.softDeleteNonChannel([7], 999)).toEqual([10]);
    expect(repo.history(-1001234567890, { limit: 10 })).toHaveLength(1);
  });

  it('latestAlive and oldestStored skip/handle deleted rows', () => {
    repo.upsert(msg({ msgId: 1 }));
    repo.upsert(msg({ msgId: 2 }));
    repo.softDelete(10, [2], 999);
    expect(repo.latestAlive(10)?.msgId).toBe(1);
    expect(repo.oldestStored(10)).toBe(1);
    expect(repo.oldestStored(99)).toBeNull();
  });

  it('search can be scoped to a chat and excludes deleted messages', () => {
    repo.upsert(msg({ chatId: 10, msgId: 1, text: 'invoice ready' }));
    repo.upsert(msg({ chatId: 20, msgId: 1, text: 'invoice paid' }));
    repo.upsert(msg({ chatId: 20, msgId: 2, text: 'invoice gone' }));
    repo.softDelete(20, [2], 999);
    expect(repo.search('invoice', { limit: 10 })).toHaveLength(2);
    expect(repo.search('invoice', { chatId: 20, limit: 10 }).map((m) => m.msgId)).toEqual([1]);
  });

  it('treats FTS operators in the query literally', () => {
    repo.upsert(msg({ text: 'say "hi" (now) OR later*' }));
    for (const q of ['"hi"', '(now)', 'OR', 'later*', '-x', 'a"b', 'NEAR(', '', 'a\0b', '\0', 'x\u0001\u001fy', '\u0007']) {
      expect(() => repo.search(q, { limit: 10 })).not.toThrow();
    }
    expect(repo.search('(now)', { limit: 10 })).toHaveLength(1);
    expect(repo.search('n\0ow', { limit: 10 })).toHaveLength(1);
  });
});
