import { beforeEach, describe, expect, it } from 'vitest';
import { ChatsRepo } from './chats-repo.js';
import { openDb } from './db.js';

const seed = { id: 10, type: 'user' as const, title: 'Alice Example', username: 'alice_example' };

describe('ChatsRepo', () => {
  let chats: ChatsRepo;
  beforeEach(() => {
    chats = new ChatsRepo(openDb(':memory:'));
  });

  it('ensure inserts once and later only refreshes title/username, never watch level', () => {
    chats.ensure(seed, 'normal', 1);
    chats.setWatchLevel(10, 'full', 2);
    chats.ensure({ ...seed, title: 'Alice Renamed' }, 'muted', 3);
    const row = chats.get(10);
    expect(row?.title).toBe('Alice Renamed');
    expect(row?.watchLevel).toBe('full');
  });

  it('bumpTop only moves forward', () => {
    chats.ensure(seed, 'normal', 1);
    chats.bumpTop(10, 5, false, 100, 2);
    chats.bumpTop(10, 3, true, 50, 3);
    expect(chats.get(10)).toMatchObject({ topMsgId: 5, topMsgOut: false, topMsgDate: 100 });
  });

  it('setReadInbox never moves the read position backwards', () => {
    chats.ensure(seed, 'normal', 1);
    chats.setReadInbox(10, 8, 0, 2);
    chats.setReadInbox(10, 4, 3, 3);
    expect(chats.get(10)?.readInboxMaxId).toBe(8);
  });

  it('applySnapshot sets counters and flags but keeps a newer top', () => {
    chats.ensure(seed, 'normal', 1);
    chats.bumpTop(10, 9, false, 200, 2);
    chats.applySnapshot(
      { chatId: 10, topMsgId: 7, topMsgOut: true, topMsgDate: 150, unreadCount: 2, readInboxMaxId: 6, readOutboxMaxId: 7, archived: true, muted: true },
      3,
    );
    expect(chats.get(10)).toMatchObject({ topMsgId: 9, unreadCount: 2, readInboxMaxId: 6, archived: true, muted: true });
  });

  it('list filters by type, unread and title query', () => {
    chats.ensure(seed, 'normal', 1);
    chats.ensure({ id: -1001, type: 'channel', title: 'News Channel', username: null }, 'muted', 1);
    chats.incrementUnread(10, 2);
    expect(chats.list({ type: 'channel', limit: 10, offset: 0 }).map((c) => c.id)).toEqual([-1001]);
    expect(chats.list({ unreadOnly: true, limit: 10, offset: 0 }).map((c) => c.id)).toEqual([10]);
    expect(chats.list({ query: 'news', limit: 10, offset: 0 }).map((c) => c.id)).toEqual([-1001]);
  });

  it('purge removes the chat and everything attached to it', () => {
    const db = openDb(':memory:');
    const repo = new ChatsRepo(db);
    repo.ensure(seed, 'normal', 1);
    db.prepare("INSERT INTO messages (chat_id, msg_id, date, out, text) VALUES (10, 1, 0, 0, 'x')").run();
    db.prepare("INSERT INTO chat_labels (chat_id, label, updated_at) VALUES (10, 'done', 0)").run();
    repo.purge(10);
    expect(repo.get(10)).toBeNull();
    expect((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT count(*) AS n FROM chat_labels').get() as { n: number }).n).toBe(0);
  });
});
