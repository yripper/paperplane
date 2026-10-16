import { MtPeerNotFoundError, tl } from '@mtcute/node';
import { AppError } from '../domain/errors.js';

const AUTH_ERRORS = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
]);
const NOT_FOUND_ERRORS = /^(PEER_ID_INVALID|CHANNEL_INVALID|CHAT_ID_INVALID|USER_ID_INVALID|MESSAGE_ID_INVALID|CHANNEL_PRIVATE)$/;

/// mtcute already retries flood waits up to 10s; anything that reaches here is
/// longer and goes back to Claude with the wait instead of blocking the tool.
export function mapTelegramError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (tl.RpcError.is(e, 'FLOOD_WAIT_%d')) {
    return new AppError('FLOOD_WAIT', `Telegram asked to wait ${e.seconds}s`, e.seconds);
  }
  if (tl.RpcError.is(e, 'SLOWMODE_WAIT_%d') || tl.RpcError.is(e, 'FLOOD_PREMIUM_WAIT_%d')) {
    return new AppError('FLOOD_WAIT', `Telegram asked to wait ${e.seconds}s`, e.seconds);
  }
  if (tl.RpcError.is(e)) {
    if (AUTH_ERRORS.has(e.text)) return new AppError('AUTH_REQUIRED', 'Telegram session is not valid: run `pm2 stop paperplane && paperplane login && pm2 start paperplane`');
    if (NOT_FOUND_ERRORS.test(e.text)) return new AppError('NOT_FOUND', `Telegram: ${e.text}`);
    if (e.code === 403) return new AppError('FORBIDDEN', `Telegram refused: ${e.text}`);
    return new AppError('INTERNAL', `Telegram error ${e.code} ${e.text}`);
  }
  if (e instanceof MtPeerNotFoundError) {
    return new AppError('NOT_FOUND', 'chat is not in the local peer cache yet: wait for the next sweep or check the id');
  }
  return new AppError('INTERNAL', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown Telegram error');
}
