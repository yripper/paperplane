import type { DeleteMode, TelegramGateway, TgDialog, TgFolder, TgMessage, TgPeer } from '../telegram/types.js';
import { peer, tgMessage } from './fixtures.js';

/// In-memory Telegram for tests. Records every call; failures are injectable
/// per method (failOn), per chat for history (failHistoryFor), or mid-way
/// through dialog iteration (failDialogsAfter).
export class FakeGateway implements TelegramGateway {
  dialogs: TgDialog[] = [];
  history = new Map<number, TgMessage[]>();
  folders: TgFolder[] = [];
  peers = new Map<number, TgPeer>();
  readonly calls: { method: string; args: unknown[] }[] = [];
  failDialogsAfter: number | null = null;
  failHistoryFor = new Set<number>();
  failOn = new Map<string, Error>();
  private nextId = 1000;

  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    const error = this.failOn.get(method);
    if (error) throw error;
  }

  async *iterDialogs(): AsyncIterable<TgDialog> {
    this.record('iterDialogs', []);
    for (const [i, d] of this.dialogs.entries()) {
      if (this.failDialogsAfter !== null && i >= this.failDialogsAfter) throw new Error('network down');
      yield d;
    }
  }

  async getHistory(chatId: number, opts: { limit: number; beforeId?: number; afterId?: number }): Promise<TgMessage[]> {
    this.record('getHistory', [chatId, opts]);
    if (this.failHistoryFor.has(chatId)) throw new Error('history failed');
    return (this.history.get(chatId) ?? [])
      .filter((m) => (opts.beforeId === undefined || m.id < opts.beforeId) && (opts.afterId === undefined || m.id > opts.afterId))
      .sort((a, b) => b.id - a.id)
      .slice(0, opts.limit);
  }

  async search(opts: { query: string; chatId?: number; limit: number }): Promise<TgMessage[]> {
    this.record('search', [opts]);
    return [...this.history.values()]
      .flat()
      .filter((m) => m.text.includes(opts.query) && (opts.chatId === undefined || m.chat.id === opts.chatId))
      .slice(0, opts.limit);
  }

  async sendText(chatId: number, text: string, replyTo?: number): Promise<TgMessage> {
    this.record('sendText', [chatId, text, replyTo]);
    return tgMessage({
      id: this.nextId++,
      chat: this.peers.get(chatId) ?? peer({ id: chatId }),
      senderId: 1,
      out: true,
      text,
      replyToMsgId: replyTo ?? null,
      date: 2000,
    });
  }

  async saveDraft(chatId: number, text: string): Promise<void> {
    this.record('saveDraft', [chatId, text]);
  }

  async markRead(chatId: number): Promise<void> {
    this.record('markRead', [chatId]);
  }

  async getFolders(): Promise<TgFolder[]> {
    this.record('getFolders', []);
    return this.folders;
  }

  async createFolder(input: { title: string; chatIds: number[] }): Promise<TgFolder> {
    this.record('createFolder', [input]);
    const folder = { id: this.folders.length + 2, title: input.title, includeChatIds: input.chatIds, excludeChatIds: [] };
    this.folders.push(folder);
    return folder;
  }

  async editFolder(
    folderId: number,
    change: { title?: string; addChatIds?: number[]; removeChatIds?: number[] },
  ): Promise<TgFolder> {
    this.record('editFolder', [folderId, change]);
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error('no folder');
    folder.title = change.title ?? folder.title;
    folder.includeChatIds = [
      ...folder.includeChatIds.filter((id) => !(change.removeChatIds ?? []).includes(id)),
      ...(change.addChatIds ?? []),
    ];
    return folder;
  }

  async deleteFolder(folderId: number): Promise<void> {
    this.record('deleteFolder', [folderId]);
  }

  async archive(chatIds: number[]): Promise<void> {
    this.record('archive', [chatIds]);
  }

  async unarchive(chatIds: number[]): Promise<void> {
    this.record('unarchive', [chatIds]);
  }

  async setMuted(chatId: number, muted: boolean): Promise<void> {
    this.record('setMuted', [chatId, muted]);
  }

  async deleteChat(chatId: number, mode: DeleteMode): Promise<void> {
    this.record('deleteChat', [chatId, mode]);
  }

  async leaveChat(chatId: number): Promise<void> {
    this.record('leaveChat', [chatId]);
  }

  async blockUser(userId: number): Promise<void> {
    this.record('blockUser', [userId]);
  }
}
