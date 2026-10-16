import { describe, expect, it } from 'vitest';
import { isChannelId } from './peer-ids.js';

describe('isChannelId', () => {
  it('recognizes marked channel ids', () => {
    expect(isChannelId(-1001234567890)).toBe(true);
  });
  it('rejects users and legacy groups', () => {
    expect(isChannelId(123456)).toBe(false);
    expect(isChannelId(-123456)).toBe(false);
  });
});
