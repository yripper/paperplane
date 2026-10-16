import type { ChatLabel, LabelKind, WatchLevel } from '../store/types.js';

export type AutoStatus = 'pending' | 'seen' | 'clear';
export type EffectiveStatus = AutoStatus | LabelKind;

export interface PendingInput {
  topMsgId: number;
  topMsgOut: boolean;
  readInboxMaxId: number;
  watchLevel: WatchLevel;
}

/// Derived purely from what Telegram reports, so replying or reading on the
/// phone changes it without Paperplane doing anything.
export function autoStatus(c: PendingInput): AutoStatus {
  if (c.watchLevel === 'muted' || c.topMsgId === 0 || c.topMsgOut) return 'clear';
  return c.readInboxMaxId >= c.topMsgId ? 'seen' : 'pending';
}

export function effectiveStatus(c: PendingInput, label: ChatLabel | null, nowSec: number): EffectiveStatus {
  if (!label) return autoStatus(c);
  if (label.label === 'snoozed' && label.snoozeUntil !== null && label.snoozeUntil <= nowSec) return autoStatus(c);
  return label.label;
}

/// "done" and "waiting" describe the conversation as of my last look; a new
/// incoming message invalidates both. A snooze is a deliberate "not until X".
export function labelSurvivesIncoming(label: ChatLabel): boolean {
  return label.label === 'snoozed';
}
