import type { Dialog, Message, Peer } from '@mtcute/node';
import type { ChatType } from '../store/types.js';
import type { TgDialog, TgMessage, TgPeer, TgSender } from './types.js';

const toSec = (d: Date): number => Math.floor(d.getTime() / 1000);

/// Gigagroups, monoforums and communities behave like supergroups for
/// Paperplane's purposes (membership, leave instead of delete).
export function mapChatType(t: string): ChatType {
  if (t === 'group') return 'group';
  if (t === 'channel') return 'channel';
  return 'supergroup';
}

export function adaptPeer(p: Peer): TgPeer {
  if (p.type === 'user') return { id: p.id, type: p.isBot ? 'bot' : 'user', title: p.displayName, username: p.username };
  return { id: p.id, type: mapChatType(p.chatType), title: p.title, username: p.username };
}

export interface HiddenLink {
  offset: number;
  length: number;
  url: string;
}

/// Telegram keeps a hyperlink's target in an entity, not in the text, so plain
/// text would lose it (contract addresses, docs). Rewrites each link as
/// markdown. Offsets are UTF-16 units, the same as JS string indexes.
export function inlineLinks(text: string, links: readonly HiddenLink[]): string {
  let out = text;
  // Back to front, so earlier offsets stay valid as the text grows.
  for (const l of [...links].sort((a, b) => b.offset - a.offset)) {
    const label = out.slice(l.offset, l.offset + l.length);
    out = `${out.slice(0, l.offset)}[${label}](${l.url})${out.slice(l.offset + l.length)}`;
  }
  return out;
}

function hiddenLinks(m: Message): HiddenLink[] {
  return m.entities.flatMap((e) => {
    if (e.params.kind === 'text_link') return [{ offset: e.offset, length: e.length, url: e.params.url }];
    // A mention of someone without a username; the link keeps who it was.
    if (e.params.kind === 'text_mention') return [{ offset: e.offset, length: e.length, url: `tg://user?id=${e.params.userId}` }];
    return [];
  });
}

export function adaptSender(p: Peer): TgSender {
  if (p.type === 'user') return { id: p.id, name: p.displayName, username: p.username, isBot: p.isBot };
  return { id: p.id, name: p.title, username: p.username, isBot: false };
}

export function adaptMessage(m: Message): TgMessage {
  return {
    id: m.id,
    chat: adaptPeer(m.chat),
    sender: adaptSender(m.sender),
    date: toSec(m.date),
    out: m.isOutgoing,
    text: inlineLinks(m.text, hiddenLinks(m)),
    mediaKind: m.media?.type ?? null,
    replyToMsgId: m.replyToMessage?.id ?? null,
    editedAt: m.editDate ? toSec(m.editDate) : null,
  };
}

export function adaptDialog(d: Dialog): TgDialog {
  return {
    chat: adaptPeer(d.peer),
    topMessage: d.lastMessage ? adaptMessage(d.lastMessage) : null,
    unreadCount: d.unreadCount,
    archived: d.isArchived,
    muted: d.isMuted,
    readInboxMaxId: d.lastReadIngoing,
    readOutboxMaxId: d.lastReadOutgoing,
  };
}
