import { describe, expect, it } from 'vitest';
import { inlineLinks, mapChatType } from './adapt.js';

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

describe('inlineLinks', () => {
  it('keeps hidden link targets as markdown links', () => {
    expect(inlineLinks('pool and factory deployed', [
      { offset: 0, length: 4, url: 'https://example.com/pool' },
      { offset: 9, length: 7, url: 'https://example.com/factory' },
    ])).toBe('[pool](https://example.com/pool) and [factory](https://example.com/factory) deployed');
  });

  it('counts offsets in UTF-16 units, like Telegram', () => {
    expect(inlineLinks('🎉 docs', [{ offset: 3, length: 4, url: 'https://example.com' }])).toBe('🎉 [docs](https://example.com)');
  });

  it('leaves text without links unchanged', () => {
    expect(inlineLinks('plain', [])).toBe('plain');
  });
});
