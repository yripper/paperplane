import { describe, expect, it } from 'vitest';
import { mapChatType } from './adapt.js';

describe('mapChatType', () => {
  it('collapses mtcute chat types into Paperplane chat types', () => {
    expect(mapChatType('group')).toBe('group');
    expect(mapChatType('supergroup')).toBe('supergroup');
    expect(mapChatType('gigagroup')).toBe('supergroup');
    expect(mapChatType('monoforum')).toBe('supergroup');
    expect(mapChatType('community')).toBe('supergroup');
    expect(mapChatType('channel')).toBe('channel');
  });
});
