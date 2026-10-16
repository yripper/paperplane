import type { TelegramGateway } from '../telegram/types.js';

/// A gateway whose target can be swapped at runtime. The daemon hands this
/// one object to ActionDeps, BackfillDeps and the sweep before Telegram is
/// connected, then swaps in the real gateway once the background connect
/// succeeds, so nothing has to be rebuilt.
export function createSwitchableGateway(initial: TelegramGateway): { gateway: TelegramGateway; set(target: TelegramGateway): void } {
  let current = initial;
  const gateway: TelegramGateway = {
    iterDialogs: () => current.iterDialogs(),
    getHistory: (chatId, opts) => current.getHistory(chatId, opts),
    search: (opts) => current.search(opts),
    sendText: (chatId, text, replyTo) => current.sendText(chatId, text, replyTo),
    saveDraft: (chatId, text) => current.saveDraft(chatId, text),
    markRead: (chatId) => current.markRead(chatId),
    getFolders: () => current.getFolders(),
    createFolder: (input) => current.createFolder(input),
    editFolder: (folderId, change) => current.editFolder(folderId, change),
    deleteFolder: (folderId) => current.deleteFolder(folderId),
    archive: (chatIds) => current.archive(chatIds),
    unarchive: (chatIds) => current.unarchive(chatIds),
    setMuted: (chatId, muted) => current.setMuted(chatId, muted),
    deleteChat: (chatId, mode) => current.deleteChat(chatId, mode),
    leaveChat: (chatId) => current.leaveChat(chatId),
    blockUser: (userId) => current.blockUser(userId),
  };
  return {
    gateway,
    set(target: TelegramGateway) {
      current = target;
    },
  };
}
