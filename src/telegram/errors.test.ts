import { MtPeerNotFoundError, tl } from '@mtcute/node';
import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { mapTelegramError } from './errors.js';

const rpc = (errorCode: number, errorMessage: string): unknown => tl.RpcError.fromTl({ errorCode, errorMessage });

describe('mapTelegramError', () => {
  it('maps FLOOD_WAIT with the wait time', () => {
    expect(mapTelegramError(rpc(420, 'FLOOD_WAIT_30'))).toMatchObject({ code: 'FLOOD_WAIT', retryAfterSec: 30 });
  });

  it('maps AUTH_KEY_UNREGISTERED to AUTH_REQUIRED', () => {
    expect(mapTelegramError(rpc(401, 'AUTH_KEY_UNREGISTERED')).code).toBe('AUTH_REQUIRED');
    expect(mapTelegramError(rpc(401, 'SESSION_REVOKED')).code).toBe('AUTH_REQUIRED');
  });

  it('maps 403s to FORBIDDEN', () => {
    expect(mapTelegramError(rpc(403, 'CHAT_WRITE_FORBIDDEN')).code).toBe('FORBIDDEN');
  });

  it('maps invalid peers and missing cache entries to NOT_FOUND', () => {
    expect(mapTelegramError(rpc(400, 'PEER_ID_INVALID')).code).toBe('NOT_FOUND');
    expect(mapTelegramError(new MtPeerNotFoundError('not cached')).code).toBe('NOT_FOUND');
  });

  it('passes AppErrors through and wraps anything else as INTERNAL', () => {
    const app = new AppError('VALIDATION', 'x');
    expect(mapTelegramError(app)).toBe(app);
    expect(mapTelegramError(new Error('socket hang up')).code).toBe('INTERNAL');
  });
});
