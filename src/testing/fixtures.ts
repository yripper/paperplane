import { ChatsRepo } from '../store/chats-repo.js';
import { CursorsRepo } from '../store/cursors-repo.js';
import { type Db, openDb } from '../store/db.js';
import { LabelsRepo } from '../store/labels-repo.js';
import { MessagesRepo } from '../store/messages-repo.js';
import type { ChatType, WatchLevel } from '../store/types.js';
import { UpdateSink } from '../sync/update-sink.js';
import type { TgDialog, TgMessage, TgPeer } from '../telegram/types.js';

// Synthetic data only: never put real names, ids or message text in fixtures.
export const peer = (over: Partial<TgPeer> = {}): TgPeer => ({
  id: 10,
  type: 'user',
  title: 'Alice Example',
  username: null,
  ...over,
});

export const tgMessage = (over: Partial<TgMessage> = {}): TgMessage => ({
  id: 1,
  chat: peer(),
  senderId: 10,
  date: 100,
  out: false,
  text: 'hello',
  mediaKind: null,
  replyToMsgId: null,
  editedAt: null,
  ...over,
});

export const tgDialog = (over: Partial<TgDialog> = {}): TgDialog => ({
  chat: peer(),
  topMessage: tgMessage(),
  unreadCount: 0,
  archived: false,
  muted: false,
  readInboxMaxId: 0,
  readOutboxMaxId: 0,
  ...over,
});

export const WATCH_DEFAULTS: Record<ChatType, WatchLevel> = {
  user: 'normal',
  bot: 'normal',
  group: 'normal',
  supergroup: 'normal',
  channel: 'muted',
};

export interface TestStore {
  db: Db;
  chats: ChatsRepo;
  messages: MessagesRepo;
  labels: LabelsRepo;
  cursors: CursorsRepo;
}

export function makeStore(): TestStore {
  const db = openDb(':memory:');
  return { db, chats: new ChatsRepo(db), messages: new MessagesRepo(db), labels: new LabelsRepo(db), cursors: new CursorsRepo(db) };
}

export function makeSink(store: TestStore, now: () => number = () => 1000): UpdateSink {
  return new UpdateSink({ ...store, watchDefaults: WATCH_DEFAULTS, now });
}
