import { AppError, describeError, type ErrorCode } from '../domain/errors.js';
import type { ChatsRepo, DialogSnapshot } from '../store/chats-repo.js';
import type { TelegramGateway, TgDialog, TgMessage } from '../telegram/types.js';
import type { UpdateSink } from './update-sink.js';

export interface SweepDeps {
  gateway: Pick<TelegramGateway, 'iterDialogs' | 'getHistory'>;
  chats: ChatsRepo;
  sink: UpdateSink;
  now: () => number;
  log: (line: string) => void;
}

export interface SweepReport {
  dialogs: number;
  deltas: number;
  failures: number;
  purged: number;
  /** True when a complete pass would have purged, but the sanity guard refused. */
  purgeSkipped: boolean;
  complete: boolean;
  /** Set when iterating dialogs failed; AUTH_REQUIRED here means the session was revoked. */
  iterationError: ErrorCode | null;
}

const DELTA_LIMIT = 100;
// getHistory is newest-first, so a delta bigger than one page is fetched by
// paging backward from the newest. Beyond this many pages the oldest part of
// the gap is left; it is not refetched later (backfill pages from the oldest
// stored message, which is already older than the gap).
const MAX_DELTA_PAGES = 10;
// Purge sanity guard: a "complete" pass that suddenly misses most chats is far
// more likely a Telegram/mtcute glitch (empty or truncated dialog list) than
// the user deleting them all, and a purge can't be undone locally.
const PURGE_MIN_CAP = 5;
const PURGE_MAX_SHARE = 0.25;

export function toSnapshot(d: TgDialog): DialogSnapshot {
  return {
    chatId: d.chat.id,
    topMsgId: d.topMessage?.id ?? 0,
    topMsgOut: d.topMessage?.out ?? false,
    topMsgDate: d.topMessage?.date ?? 0,
    unreadCount: d.unreadCount,
    readInboxMaxId: d.readInboxMaxId,
    readOutboxMaxId: d.readOutboxMaxId,
    archived: d.archived,
    muted: d.muted === true,
  };
}

/// Backstop for Telegram's admitted habit of throttling channel pushes
/// (core.telegram.org/api/updates). mtcute's gap recovery is the main path;
/// this catches whatever it still misses, fetching only the delta per chat.
export async function runSweep(d: SweepDeps): Promise<SweepReport> {
  const report: SweepReport = { dialogs: 0, deltas: 0, failures: 0, purged: 0, purgeSkipped: false, complete: false, iterationError: null };
  // iterDialogs pages by top-message date, so a chat that received a message
  // (or was created) mid-sweep may never be yielded; anything touched since
  // the sweep began must not be purged.
  const sweepStart = d.now();
  const seen = new Set<number>();
  try {
    for await (const dialog of d.gateway.iterDialogs()) {
      report.dialogs++;
      seen.add(dialog.chat.id);
      try {
        if (await syncDialog(d, dialog)) report.deltas++;
      } catch (e) {
        report.failures++;
        d.log(`sweep: dialog ${dialog.chat.id} failed: ${describeError(e)}`);
      }
    }
    report.complete = true;
  } catch (e) {
    report.iterationError = e instanceof AppError ? e.code : 'INTERNAL';
    d.log(`sweep: dialog iteration failed: ${describeError(e)}`);
  }
  // Only a complete pass proves a chat is gone (deleted or left on another
  // device); a partial pass simply didn't reach it.
  if (report.complete) purgeMissing(d, seen, sweepStart, report);
  return report;
}

function purgeMissing(d: SweepDeps, seen: Set<number>, sweepStart: number, report: SweepReport): void {
  const stored = d.chats.allIds();
  const missing = stored.filter((id) => !seen.has(id) && !touchedSince(d.chats, id, sweepStart));
  if (missing.length === 0) return;
  if (seen.size === 0 || missing.length > Math.max(PURGE_MIN_CAP, stored.length * PURGE_MAX_SHARE)) {
    report.purgeSkipped = true;
    d.log(`sweep: purge skipped (would remove ${missing.length} of ${stored.length} chats)`);
    return;
  }
  for (const id of missing) d.chats.purge(id);
  report.purged = missing.length;
}

async function syncDialog(d: SweepDeps, dialog: TgDialog): Promise<boolean> {
  const before = d.sink.ensureChat(dialog.chat, dialog.muted === true);
  const top = dialog.topMessage;
  let fetchedDelta = false;
  if (top && top.id > before.topMsgId) {
    // First sight has nothing to diff against; muted chats keep metadata only.
    if (before.watchLevel !== 'muted' && before.topMsgId > 0) {
      const delta = await fetchDelta(d, dialog.chat.id, before.topMsgId);
      for (const m of delta.reverse()) d.sink.onMessage(m);
      fetchedDelta = true;
    }
    d.sink.onMessage(top);
  }
  d.chats.applySnapshot(toSnapshot(dialog), d.now());
  return fetchedDelta;
}

function touchedSince(chats: ChatsRepo, id: number, sinceSec: number): boolean {
  const chat = chats.get(id);
  return chat !== null && chat.updatedAt >= sinceSec;
}

/// Newest-first messages with id > oldTop. Pages backward until a short page
/// or one reaching oldTop; at the page cap the oldest part of the gap stays.
async function fetchDelta(d: SweepDeps, chatId: number, oldTop: number): Promise<TgMessage[]> {
  const collected: TgMessage[] = [];
  let beforeId: number | undefined;
  for (let page = 0; page < MAX_DELTA_PAGES; page++) {
    const batch = await d.gateway.getHistory(chatId, { limit: DELTA_LIMIT, afterId: oldTop, beforeId });
    collected.push(...batch);
    if (batch.length < DELTA_LIMIT || batch.some((m) => m.id <= oldTop)) return collected;
    beforeId = Math.min(...batch.map((m) => m.id));
  }
  d.log(`chat ${chatId}: delta gap left (${collected.length} messages fetched, oldest id ${beforeId ?? 0}, previous top ${oldTop})`);
  return collected;
}
