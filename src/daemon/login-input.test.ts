import { describe, expect, it } from 'vitest';
import { apiHashPrompt, apiIdPrompt, pickApiHash, pickApiId } from './login-input.js';

describe('pickApiId', () => {
  it('parses a typed id', () => {
    expect(pickApiId('12345', undefined)).toBe(12345);
    expect(pickApiId(' 678 ', 12345)).toBe(678);
  });

  it('keeps the stored id on Enter', () => {
    expect(pickApiId('', 12345)).toBe(12345);
  });

  it('rejects empty input with nothing stored, and non-positive or non-integer ids', () => {
    for (const [input, stored] of [['', undefined], ['abc', undefined], ['0', 1], ['-3', 1], ['1.5', 1]] as const) {
      expect(() => pickApiId(input, stored)).toThrowError(/api_id must be a positive integer/);
    }
  });
});

describe('pickApiHash', () => {
  it('uses a typed hash', () => {
    expect(pickApiHash('abc123', null)).toBe('abc123');
    expect(pickApiHash(' new ', 'old')).toBe('new');
  });

  it('keeps the stored hash on Enter', () => {
    expect(pickApiHash('', 'old')).toBe('old');
  });

  it('rejects an empty hash when nothing is stored', () => {
    expect(() => pickApiHash('  ', null)).toThrowError(/api_hash must not be empty/);
  });
});

describe('prompts', () => {
  it('shows the stored api_id as the default', () => {
    expect(apiIdPrompt(12345)).toBe('api_id (from https://my.telegram.org) [12345]: ');
    expect(apiIdPrompt(undefined)).toBe('api_id (from https://my.telegram.org): ');
  });

  it('offers to keep the stored api_hash without showing it', () => {
    expect(apiHashPrompt(true)).toBe('api_hash (press Enter to keep current): ');
    expect(apiHashPrompt(false)).toBe('api_hash: ');
  });
});
