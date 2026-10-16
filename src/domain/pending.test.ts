import { describe, expect, it } from 'vitest';
import type { ChatLabel } from '../store/types.js';
import { autoStatus, effectiveStatus, labelSurvivesIncoming, type PendingInput } from './pending.js';

const chat = (over: Partial<PendingInput> = {}): PendingInput => ({
  topMsgId: 10,
  topMsgOut: false,
  readInboxMaxId: 0,
  watchLevel: 'normal',
  ...over,
});
const label = (over: Partial<ChatLabel>): ChatLabel => ({ chatId: 1, label: 'done', snoozeUntil: null, note: null, updatedAt: 0, ...over });

describe('autoStatus', () => {
  it('is pending when the last message is theirs and unread', () => {
    expect(autoStatus(chat())).toBe('pending');
  });
  it('is seen when I read past the last message without replying', () => {
    expect(autoStatus(chat({ readInboxMaxId: 10 }))).toBe('seen');
  });
  it('is clear when the last message is mine', () => {
    expect(autoStatus(chat({ topMsgOut: true }))).toBe('clear');
  });
  it('is clear for muted chats and empty chats', () => {
    expect(autoStatus(chat({ watchLevel: 'muted' }))).toBe('clear');
    expect(autoStatus(chat({ topMsgId: 0 }))).toBe('clear');
  });
});

describe('effectiveStatus', () => {
  it('lets my label override the automatic status', () => {
    expect(effectiveStatus(chat(), label({ label: 'waiting' }), 100)).toBe('waiting');
  });
  it('falls back to automatic when a snooze expired', () => {
    expect(effectiveStatus(chat(), label({ label: 'snoozed', snoozeUntil: 50 }), 100)).toBe('pending');
  });
  it('keeps an active snooze', () => {
    expect(effectiveStatus(chat(), label({ label: 'snoozed', snoozeUntil: 500 }), 100)).toBe('snoozed');
  });
});

describe('labelSurvivesIncoming', () => {
  it('only snoozes survive a new incoming message', () => {
    expect(labelSurvivesIncoming(label({ label: 'snoozed', snoozeUntil: 1 }))).toBe(true);
    expect(labelSurvivesIncoming(label({ label: 'done' }))).toBe(false);
    expect(labelSurvivesIncoming(label({ label: 'waiting' }))).toBe(false);
  });
});
