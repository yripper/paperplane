import type { ChatsRepo } from '../store/chats-repo.js';
import type { SendersRepo } from '../store/senders-repo.js';
import type { SenderRow } from '../store/types.js';
import type { TelegramGateway } from '../telegram/types.js';

export interface SenderDeps {
  gateway: Pick<TelegramGateway, 'getUsers'>;
  senders: SendersRepo;
  chats: Pick<ChatsRepo, 'get'>;
  /** Unix seconds. */
  now: () => number;
}

/// Names for the senders of messages about to be shown. Messages stored before
/// senders were tracked only have an id, so unknown users are fetched once and
/// stored. Best effort: offline or unresolvable senders just stay nameless.
export async function resolveSenders(d: SenderDeps, ids: (number | null)[]): Promise<Map<number, SenderRow>> {
  const unique = [...new Set(ids.filter((id): id is number => id !== null))];
  const known = d.senders.getMany(unique);
  // Negative ids are chats (a channel or anonymous admin posting as the group):
  // named from the chats table; only users go to Telegram.
  for (const id of unique.filter((i) => i < 0 && !known.has(i))) {
    const chat = d.chats.get(id);
    if (chat) known.set(id, { id, name: chat.title, username: chat.username, isBot: false, updatedAt: chat.updatedAt });
  }
  const missing = unique.filter((id) => id > 0 && !known.has(id));
  if (missing.length === 0) return known;
  try {
    const now = d.now();
    for (const s of await d.gateway.getUsers(missing)) {
      d.senders.upsert(s, now);
      known.set(s.id, { ...s, updatedAt: now });
    }
  } catch {
    // Names are a nicety; reading history must not fail because of them.
  }
  return known;
}
