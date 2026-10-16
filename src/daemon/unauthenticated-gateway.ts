import { AppError } from '../domain/errors.js';
import type { TelegramGateway, TgDialog } from '../telegram/types.js';

const notLoggedIn = (): AppError =>
  new AppError('AUTH_REQUIRED', 'not logged in: run `paperplane login`, then `pm2 restart paperplane`');

const reject = (): Promise<never> => Promise.reject(notLoggedIn());

/// Stands in for the real gateway while the daemon is up but has no usable
/// Telegram session, so MCP reads of the local store and `status` keep working
/// and every Telegram call fails with a clear, actionable error instead of
/// reaching an unauthorized mtcute client.
export function createUnauthenticatedGateway(): TelegramGateway {
  return {
    // eslint-disable-next-line require-yield -- must throw on first iteration, never yield
    iterDialogs: async function* (): AsyncGenerator<TgDialog> {
      throw notLoggedIn();
    },
    getHistory: reject,
    search: reject,
    sendText: reject,
    saveDraft: reject,
    markRead: reject,
    getFolders: reject,
    createFolder: reject,
    editFolder: reject,
    deleteFolder: reject,
    archive: reject,
    unarchive: reject,
    setMuted: reject,
    deleteChat: reject,
    leaveChat: reject,
    blockUser: reject,
  };
}
