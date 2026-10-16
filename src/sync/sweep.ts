import { AppError, describeError, type ErrorCode } from '../domain/errors.js';
import type { ChatsRepo, DialogSnapshot } from '../store/chats-repo.js';
import type { TelegramGateway, TgDialog } from '../telegram/types.js';
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
  complete: boolean;
  /** Set when iterating dialogs failed; AUTH_REQUIRED here means the session was revoked. */
  iterationError: ErrorCode | null;
}

// Beyond this many missed messages, older ones load on demand via read_history.
const DELTA_LIMIT = 100;

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
  const report: SweepReport = { dialogs: 0, deltas: 0, failures: 0, purged: 0, complete: false, iterationError: null };
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
  if (report.complete) {
    for (const id of d.chats.allIds()) {
      if (!seen.has(id)) {
        d.chats.purge(id);
        report.purged++;
      }
    }
  }
  return report;
}

async function syncDialog(d: SweepDeps, dialog: TgDialog): Promise<boolean> {
  const before = d.sink.ensureChat(dialog.chat, dialog.muted === true);
  const top = dialog.topMessage;
  let fetchedDelta = false;
  if (top && top.id > before.topMsgId) {
    // First sight has nothing to diff against; muted chats keep metadata only.
    if (before.watchLevel !== 'muted' && before.topMsgId > 0) {
      const delta = await d.gateway.getHistory(dialog.chat.id, { limit: DELTA_LIMIT, afterId: before.topMsgId });
      for (const m of [...delta].reverse()) d.sink.onMessage(m);
      fetchedDelta = true;
    }
    d.sink.onMessage(top);
  }
  d.chats.applySnapshot(toSnapshot(dialog), d.now());
  return fetchedDelta;
}
