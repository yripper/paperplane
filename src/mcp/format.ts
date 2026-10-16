import type { PendingItem } from '../store/pending-query.js';
import type { ChatRow, MessageRow, SenderRow } from '../store/types.js';

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

export interface MessageView {
  id: number;
  date: string;
  from: 'me' | SenderView | null;
  text: string;
  media: string | null;
  replyTo: number | null;
  edited: boolean;
  viaPaperplane: boolean;
}

/** name and username are null for senders Paperplane couldn't look up. */
export interface SenderView {
  id: number;
  name: string | null;
  username: string | null;
}

export interface ChatView {
  id: number;
  type: string;
  title: string;
  username: string | null;
  watchLevel: string;
  unread: number;
  archived: boolean;
  muted: boolean;
  lastMessageAt: string | null;
  lastMessageFromMe: boolean;
}

export interface PendingView extends ChatView {
  status: 'pending' | 'seen';
  waitingSince: string;
  label: string | null;
  note: string | null;
}

function formatSender(id: number | null, senders: ReadonlyMap<number, SenderRow>): SenderView | null {
  if (id === null) return null;
  const s = senders.get(id);
  return { id, name: s?.name ?? null, username: s?.username ?? null };
}

export function formatMessage(m: MessageRow, senders: ReadonlyMap<number, SenderRow> = new Map()): MessageView {
  return {
    id: m.msgId,
    date: iso(m.date),
    from: m.out ? 'me' : formatSender(m.senderId, senders),
    // Media-only messages still need something readable in a transcript.
    text: m.text || (m.mediaKind ? `[${m.mediaKind}]` : ''),
    media: m.mediaKind,
    replyTo: m.replyToMsgId,
    edited: m.editedAt !== null,
    viaPaperplane: m.sentViaPaperplane,
  };
}

export function formatChat(c: ChatRow): ChatView {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    username: c.username,
    watchLevel: c.watchLevel,
    unread: c.unreadCount,
    archived: c.archived,
    muted: c.muted,
    lastMessageAt: c.topMsgDate ? iso(c.topMsgDate) : null,
    lastMessageFromMe: c.topMsgOut,
  };
}

export function formatPending(p: PendingItem): PendingView {
  return {
    ...formatChat(p.chat),
    status: p.status,
    waitingSince: iso(p.waitingSinceSec),
    label: p.label?.label ?? null,
    note: p.label?.note ?? null,
  };
}
