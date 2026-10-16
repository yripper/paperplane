import type { ChatRow, ChatType } from '../store/types.js';

export interface CleanupCriteria {
  inactiveDays?: number;
  types?: ChatType[];
  minUnread?: number;
  mutedOnly?: boolean;
  archivedOnly?: boolean;
}

export type CleanupMode = 'remove' | 'archive';
export type CleanupAction = 'delete' | 'leave' | 'archive';

const DAY_SEC = 86_400;

/// Criteria combine with AND. `full` chats are the ones I said I care about
/// most, so cleanup never touches them regardless of criteria.
export function selectForCleanup(chats: ChatRow[], c: CleanupCriteria, nowSec: number): ChatRow[] {
  return chats.filter(
    (ch) =>
      ch.watchLevel !== 'full' &&
      (c.inactiveDays === undefined || ch.topMsgDate <= nowSec - c.inactiveDays * DAY_SEC) &&
      (c.types === undefined || c.types.includes(ch.type)) &&
      (c.minUnread === undefined || ch.unreadCount >= c.minUnread) &&
      (!c.mutedOnly || ch.muted || ch.watchLevel === 'muted') &&
      (!c.archivedOnly || ch.archived),
  );
}

/// Private chats can be deleted; groups and channels have to be left
/// (deleteHistory only covers private chats and basic groups' history).
export function cleanupActionFor(type: ChatType, mode: CleanupMode): CleanupAction {
  if (mode === 'archive') return 'archive';
  return type === 'user' || type === 'bot' ? 'delete' : 'leave';
}
