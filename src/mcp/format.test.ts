import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../store/types.js';
import { formatMessage } from './format.js';

const row = (over: Partial<MessageRow>): MessageRow => ({
  chatId: 10, msgId: 1, senderId: 10, date: 0, out: false, text: 'hi', mediaKind: null,
  replyToMsgId: null, editedAt: null, deletedAt: null, sentViaPaperplane: false, ...over,
});

describe('formatMessage', () => {
  it('shows who sent it and an ISO date', () => {
    expect(formatMessage(row({ out: true }))).toMatchObject({ id: 1, from: 'me', date: '1970-01-01T00:00:00.000Z', text: 'hi' });
    expect(formatMessage(row({})).from).toBe(10);
  });

  it('formats media-only messages', () => {
    expect(formatMessage(row({ text: '', mediaKind: 'voice' }))).toMatchObject({ text: '[voice]', media: 'voice' });
  });
});
