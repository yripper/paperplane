import { getMarkedPeerId, type TelegramClient, type tl } from '@mtcute/node';
import { AppError } from '../domain/errors.js';
import { adaptDialog, adaptMessage } from './adapt.js';
import { mapTelegramError } from './errors.js';
import type { DeleteMode, TelegramGateway, TgDialog, TgFolder, TgMessage } from './types.js';

// INT32_MAX: Telegram's conventional "muted forever".
const MUTE_FOREVER = 2_147_483_647;

function peerIdOf(p: tl.TypeInputPeer): number | null {
  try {
    return getMarkedPeerId(p);
  } catch {
    return null; // inputPeerSelf / inputPeerEmpty have no marked id
  }
}

function adaptFolder(f: tl.RawDialogFilter): TgFolder {
  return {
    id: f.id,
    title: f.title.text,
    includeChatIds: f.includePeers.map(peerIdOf).filter((id): id is number => id !== null),
    excludeChatIds: f.excludePeers.map(peerIdOf).filter((id): id is number => id !== null),
  };
}

export class MtcuteGateway implements TelegramGateway {
  constructor(private readonly tg: TelegramClient) {}

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw mapTelegramError(e);
    }
  }

  async *iterDialogs(): AsyncIterable<TgDialog> {
    try {
      // Default is 'exclude': archived chats would silently never sync.
      for await (const d of this.tg.iterDialogs({ archived: 'keep' })) yield adaptDialog(d);
    } catch (e) {
      throw mapTelegramError(e);
    }
  }

  getHistory(chatId: number, opts: { limit: number; beforeId?: number; afterId?: number }): Promise<TgMessage[]> {
    return this.guard(async () => {
      const page = await this.tg.getHistory(chatId, {
        limit: opts.limit,
        offset: opts.beforeId === undefined ? undefined : { id: opts.beforeId, date: 0 },
        minId: opts.afterId,
      });
      return page.map(adaptMessage);
    });
  }

  search(opts: { query: string; chatId?: number; limit: number }): Promise<TgMessage[]> {
    return this.guard(async () => (await this.tg.searchMessages(opts)).map(adaptMessage));
  }

  sendText(chatId: number, text: string, replyTo?: number): Promise<TgMessage> {
    return this.guard(async () => adaptMessage(await this.tg.sendText(chatId, text, { replyTo })));
  }

  saveDraft(chatId: number, text: string): Promise<void> {
    return this.guard(() => this.tg.saveDraft(chatId, { message: text }));
  }

  markRead(chatId: number): Promise<void> {
    return this.guard(() => this.tg.readHistory(chatId));
  }

  private async rawFolders(): Promise<tl.RawDialogFilter[]> {
    const res = await this.tg.getFolders();
    return res.filters.filter((f): f is tl.RawDialogFilter => f._ === 'dialogFilter');
  }

  getFolders(): Promise<TgFolder[]> {
    return this.guard(async () => (await this.rawFolders()).map(adaptFolder));
  }

  createFolder(input: { title: string; chatIds: number[] }): Promise<TgFolder> {
    return this.guard(async () => {
      const includePeers = await Promise.all(input.chatIds.map((id) => this.tg.resolvePeer(id)));
      const folder = await this.tg.createFolder({
        title: { _: 'textWithEntities', text: input.title, entities: [] },
        includePeers,
        excludePeers: [],
        pinnedPeers: [],
      });
      return adaptFolder(folder);
    });
  }

  editFolder(folderId: number, change: { title?: string; addChatIds?: number[]; removeChatIds?: number[] }): Promise<TgFolder> {
    return this.guard(async () => {
      const current = (await this.rawFolders()).find((f) => f.id === folderId);
      if (!current) throw new AppError('NOT_FOUND', `unknown folder ${folderId}`);
      const remove = new Set(change.removeChatIds ?? []);
      const kept = current.includePeers.filter((p) => !remove.has(peerIdOf(p) ?? Number.NaN));
      const added = await Promise.all((change.addChatIds ?? []).map((id) => this.tg.resolvePeer(id)));
      const folder = await this.tg.editFolder({
        folder: current,
        modification: {
          includePeers: [...kept, ...added],
          ...(change.title === undefined ? {} : { title: { _: 'textWithEntities', text: change.title, entities: [] } }),
        },
      });
      return adaptFolder(folder);
    });
  }

  deleteFolder(folderId: number): Promise<void> {
    return this.guard(() => this.tg.deleteFolder(folderId));
  }

  archive(chatIds: number[]): Promise<void> {
    return this.guard(() => this.tg.archiveChats(chatIds));
  }

  unarchive(chatIds: number[]): Promise<void> {
    return this.guard(() => this.tg.unarchiveChats(chatIds));
  }

  setMuted(chatId: number, muted: boolean): Promise<void> {
    // No high-level mute method in mtcute 0.32; raw call verified against the TL schema.
    return this.guard(async () => {
      await this.tg.call({
        _: 'account.updateNotifySettings',
        peer: { _: 'inputNotifyPeer', peer: await this.tg.resolvePeer(chatId) },
        settings: { _: 'inputPeerNotifySettings', muteUntil: muted ? MUTE_FOREVER : 0 },
      });
    });
  }

  deleteChat(chatId: number, mode: DeleteMode): Promise<void> {
    return this.guard(() => this.tg.deleteHistory(chatId, { mode }));
  }

  leaveChat(chatId: number): Promise<void> {
    return this.guard(() => this.tg.leaveChat(chatId));
  }

  blockUser(userId: number): Promise<void> {
    return this.guard(() => this.tg.blockUser(userId));
  }
}
