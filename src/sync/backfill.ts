import { AppError, describeError } from '../domain/errors.js';
import type { ChatsRepo } from '../store/chats-repo.js';
import type { CursorsRepo } from '../store/cursors-repo.js';
import type { MessagesRepo } from '../store/messages-repo.js';
import type { MessageRow } from '../store/types.js';
import type { TelegramGateway } from '../telegram/types.js';
import { toMessageRow, type UpdateSink } from './update-sink.js';

export interface BackfillDeps {
  gateway: Pick<TelegramGateway, 'getHistory'>;
  chats: ChatsRepo;
  messages: MessagesRepo;
  cursors: CursorsRepo;
  sink: UpdateSink;
}

const PAGE_SIZE = 100;
// Caps how many pages one read_history call may pull, so a huge request
// can't turn into hundreds of back-to-back Telegram calls.
const MAX_PAGES_PER_READ = 5;

export async function backfillPage(
  d: BackfillDeps,
  chatId: number,
  pageSize: number = PAGE_SIZE,
): Promise<{ fetched: number; complete: boolean }> {
  const cursor = d.cursors.get(chatId);
  if (cursor?.backfillComplete) return { fetched: 0, complete: true };
  const beforeId = cursor?.oldestSyncedMsgId ?? d.messages.oldestStored(chatId) ?? undefined;
  const page = await d.gateway.getHistory(chatId, { limit: pageSize, beforeId });
  for (const m of page) d.sink.onMessage(m);
  const oldest = page.reduce<number | null>((min, m) => (min === null ? m.id : Math.min(min, m.id)), beforeId ?? null);
  const complete = page.length < pageSize;
  d.cursors.set({ chatId, oldestSyncedMsgId: oldest, backfillComplete: complete });
  return { fetched: page.length, complete };
}

/// Store first, Telegram for whatever's missing. Muted chats aren't stored at
/// all, so they always read straight from Telegram. `refresh` re-fetches the
/// page through the sink, which rewrites stored text (hidden links) and senders.
export async function readHistory(
  d: BackfillDeps,
  chatId: number,
  opts: { limit: number; beforeId?: number; refresh?: boolean },
): Promise<MessageRow[]> {
  const chat = d.chats.get(chatId);
  if (!chat) throw new AppError('NOT_FOUND', `unknown chat ${chatId}`);
  const page = { limit: opts.limit, beforeId: opts.beforeId };
  if (chat.watchLevel === 'muted') {
    return (await d.gateway.getHistory(chatId, page)).map((m) => toMessageRow(m, false));
  }
  if (opts.refresh) for (const m of await d.gateway.getHistory(chatId, page)) d.sink.onMessage(m);
  let rows = d.messages.history(chatId, page);
  for (let pages = 0; rows.length < opts.limit && pages < MAX_PAGES_PER_READ; pages++) {
    const fetched = await backfillPage(d, chatId);
    rows = d.messages.history(chatId, page);
    if (fetched.fetched === 0 || fetched.complete) break;
  }
  return rows;
}

export async function backfillFullChats(d: BackfillDeps & { log: (line: string) => void }): Promise<number> {
  let pages = 0;
  for (const chat of d.chats.list({ watchLevel: 'full', limit: 1000, offset: 0 })) {
    if (d.cursors.get(chat.id)?.backfillComplete) continue;
    try {
      await backfillPage(d, chat.id);
      pages++;
    } catch (e) {
      d.log(`backfill: chat ${chat.id} failed: ${describeError(e)}`);
    }
  }
  return pages;
}
