export type ChatType = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';
export type WatchLevel = 'full' | 'normal' | 'muted';
export type LabelKind = 'snoozed' | 'done' | 'waiting';

/** All timestamps in the store are unix seconds. */
export interface ChatRow {
  id: number;
  type: ChatType;
  title: string;
  username: string | null;
  watchLevel: WatchLevel;
  archived: boolean;
  muted: boolean;
  topMsgId: number;
  topMsgOut: boolean;
  topMsgDate: number;
  unreadCount: number;
  readInboxMaxId: number;
  readOutboxMaxId: number;
  updatedAt: number;
}

export interface MessageRow {
  chatId: number;
  msgId: number;
  senderId: number | null;
  date: number;
  out: boolean;
  text: string;
  mediaKind: string | null;
  replyToMsgId: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  sentViaPaperplane: boolean;
}

export interface ChatLabel {
  chatId: number;
  label: LabelKind;
  snoozeUntil: number | null;
  note: string | null;
  updatedAt: number;
}
