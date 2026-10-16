import { AppError } from '../domain/errors.js';
import type { TelegramGateway, TgDialog } from '../telegram/types.js';

export const NOT_LOGGED_IN = 'not logged in: run `pm2 stop paperplane && paperplane login && pm2 start paperplane`';
export const NOT_CONNECTED = 'Telegram not connected yet';

/// Stands in for the real gateway while the daemon is up but has no usable
/// Telegram session, so MCP reads of the local store and `status` keep working
/// and every Telegram call fails with a clear, actionable error instead of
/// reaching an unauthorized mtcute client. While the background connect is
/// still running it is created with NOT_CONNECTED; AUTH_REQUIRED is reused
/// for that case because the caller's remedy (wait, or log in) is the same
/// kind of thing and a new code would ripple through every tool for little.
export function createUnauthenticatedGateway(message: string = NOT_LOGGED_IN): TelegramGateway {
  const notLoggedIn = (): AppError => new AppError('AUTH_REQUIRED', message);
  const reject = (): Promise<never> => Promise.reject(notLoggedIn());
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
