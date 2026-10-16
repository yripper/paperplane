import type { ChatType } from '../store/types.js';

export interface TgPeer {
  id: number;
  type: ChatType;
  title: string;
  username: string | null;
}

export interface TgMessage {
  id: number;
  chat: TgPeer;
  senderId: number | null;
  date: number;
  out: boolean;
  text: string;
  mediaKind: string | null;
  replyToMsgId: number | null;
  editedAt: number | null;
}

export interface TgDialog {
  chat: TgPeer;
  topMessage: TgMessage | null;
  unreadCount: number;
  archived: boolean;
  muted: boolean | null;
  readInboxMaxId: number;
  readOutboxMaxId: number;
}

export interface TgFolder {
  id: number;
  title: string;
  includeChatIds: number[];
  excludeChatIds: number[];
}

export interface TgDeleteEvent {
  channelId: number | null;
  messageIds: number[];
}

export interface TgReadEvent {
  chatId: number;
  maxReadId: number;
  isOutbox: boolean;
  unreadCount: number;
}

export type DeleteMode = 'delete' | 'clear' | 'revoke';

/// Everything outside src/telegram talks to Telegram through this interface,
/// so sync, actions and MCP are testable with FakeGateway and never import
/// mtcute. getHistory returns newest first.
export interface TelegramGateway {
  iterDialogs(): AsyncIterable<TgDialog>;
  getHistory(chatId: number, opts: { limit: number; beforeId?: number; afterId?: number }): Promise<TgMessage[]>;
  search(opts: { query: string; chatId?: number; limit: number }): Promise<TgMessage[]>;
  sendText(chatId: number, text: string, replyTo?: number): Promise<TgMessage>;
  saveDraft(chatId: number, text: string): Promise<void>;
  markRead(chatId: number): Promise<void>;
  getFolders(): Promise<TgFolder[]>;
  createFolder(input: { title: string; chatIds: number[] }): Promise<TgFolder>;
  editFolder(folderId: number, change: { title?: string; addChatIds?: number[]; removeChatIds?: number[] }): Promise<TgFolder>;
  deleteFolder(folderId: number): Promise<void>;
  archive(chatIds: number[]): Promise<void>;
  unarchive(chatIds: number[]): Promise<void>;
  setMuted(chatId: number, muted: boolean): Promise<void>;
  deleteChat(chatId: number, mode: DeleteMode): Promise<void>;
  leaveChat(chatId: number): Promise<void>;
  blockUser(userId: number): Promise<void>;
}
