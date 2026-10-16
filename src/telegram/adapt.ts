import type { Dialog, Message, Peer } from '@mtcute/node';
import type { ChatType } from '../store/types.js';
import type { TgDialog, TgMessage, TgPeer } from './types.js';

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

export function adaptMessage(m: Message): TgMessage {
  return {
    id: m.id,
    chat: adaptPeer(m.chat),
    senderId: m.sender.id,
    date: toSec(m.date),
    out: m.isOutgoing,
    text: m.text,
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
