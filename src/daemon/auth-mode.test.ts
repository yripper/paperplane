import { describe, expect, it } from 'vitest';
import { decideAuthMode } from './auth-mode.js';

describe('decideAuthMode', () => {
  it.each([
    [false, false, null, 'auth_required'],
    [false, true, null, 'auth_required'],
    [true, false, null, 'auth_required'],
    [true, false, 'ok', 'auth_required'],
    [true, true, null, 'connect'],
    [true, true, 'ok', 'ok'],
    [true, true, 'auth_required', 'auth_required'],
  ] as const)('apiId=%s apiHash=%s connect=%s -> %s', (hasApiId, hasApiHash, connect, expected) => {
    expect(decideAuthMode({ hasApiId, hasApiHash, connect })).toBe(expected);
  });
});
