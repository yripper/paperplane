import { type CleanupCriteria, type CleanupMode, cleanupActionFor, selectForCleanup } from '../domain/cleanup-criteria.js';
import { AppError, type ErrorCode } from '../domain/errors.js';
import type { CleanupItem, CleanupPlan } from '../store/cleanup-plans-repo.js';
import { acquire, type ActionDeps, audited } from './context.js';

const PLAN_TTL_SEC = 30 * 60;

export interface CleanupReport {
  done: number[];
  failed: { chatId: number; code: ErrorCode }[];
  skipped: number[];
}

/// Step one of two: a numbered list Claude shows me, with no side effects.
export function createCleanupPlan(d: ActionDeps, criteria: CleanupCriteria, mode: CleanupMode): CleanupPlan {
  // `false`/empty values don't narrow anything, so they must not pass as a criterion.
  const narrows =
    criteria.inactiveDays !== undefined ||
    (criteria.types?.length ?? 0) > 0 ||
    criteria.minUnread !== undefined ||
    criteria.mutedOnly === true ||
    criteria.archivedOnly === true;
  if (!narrows) {
    throw new AppError('VALIDATION', 'cleanup_plan needs at least one criterion');
  }
  const now = d.now();
  const items: CleanupItem[] = selectForCleanup(d.chats.list({ limit: 100_000, offset: 0 }), criteria, now).map((c) => ({
    chatId: c.id,
    title: c.title,
    type: c.type,
    action: cleanupActionFor(c.type, mode),
  }));
  const plan: CleanupPlan = { id: d.newId(), createdAt: now, expiresAt: now + PLAN_TTL_SEC, mode, criteria, items, status: 'draft' };
  d.plans.insert(plan);
  return plan;
}

type Verdict = { ok: true } | { ok: false; code: ErrorCode };

/// Plans live up to 30 minutes, so the chat may have been deleted or promoted
/// to `full` since it was listed. Re-read before touching it.
function recheck(d: ActionDeps, chatId: number): Verdict {
  const chat = d.chats.get(chatId);
  if (!chat) return { ok: false, code: 'NOT_FOUND' };
  if (chat.watchLevel === 'full') return { ok: false, code: 'FORBIDDEN' };
  return { ok: true };
}

const codeOf = (e: unknown): ErrorCode => (e instanceof AppError ? e.code : 'INTERNAL');

export async function applyCleanupPlan(d: ActionDeps, planId: string, exclude: number[] = []): Promise<CleanupReport> {
  const plan = d.plans.get(planId);
  if (!plan) throw new AppError('NOT_FOUND', `unknown cleanup plan ${planId}`);
  if (plan.expiresAt <= d.now()) throw new AppError('VALIDATION', 'cleanup plan expired: create a new one');
  if (plan.status !== 'draft') throw new AppError('VALIDATION', 'cleanup plan already applied');

  const items = plan.items.filter((i) => !exclude.includes(i.chatId));
  const report: CleanupReport = { done: [], failed: [], skipped: [] };

  if (plan.mode === 'archive') {
    const ids: number[] = [];
    for (const item of items) {
      const verdict = recheck(d, item.chatId);
      if (verdict.ok) ids.push(item.chatId);
      else report.failed.push({ chatId: item.chatId, code: verdict.code });
    }
    // Checked before markApplied so a rate-limited call leaves the plan re-appliable.
    if (ids.length > 0) acquire(d.limits.destructive.tryAcquire());
    if (!d.plans.markApplied(planId)) throw new AppError('VALIDATION', 'cleanup plan already applied');
    if (ids.length === 0) return report;
    try {
      await audited(d, 'cleanup_archive', null, () => d.gateway.archive(ids));
      d.chats.setArchived(ids, true, d.now());
      report.done = ids;
    } catch (e) {
      const code = codeOf(e);
      report.failed.push(...ids.map((chatId) => ({ chatId, code })));
    }
    return report;
  }

  if (!d.plans.markApplied(planId)) throw new AppError('VALIDATION', 'cleanup plan already applied');

  for (const [index, item] of items.entries()) {
    const verdict = recheck(d, item.chatId);
    if (!verdict.ok) {
      report.failed.push({ chatId: item.chatId, code: verdict.code });
      continue;
    }
    if (!d.limits.destructive.tryAcquire().ok) {
      report.skipped = items.slice(index).map((i) => i.chatId);
      break;
    }
    try {
      await audited(d, `cleanup_${item.action}`, item.chatId, () =>
        item.action === 'delete' ? d.gateway.deleteChat(item.chatId, 'delete') : d.gateway.leaveChat(item.chatId),
      );
      d.chats.purge(item.chatId);
      report.done.push(item.chatId);
    } catch (e) {
      const code = codeOf(e);
      report.failed.push({ chatId: item.chatId, code });
      // A long flood wait applies to everything that follows; stop instead of hammering.
      if (code === 'FLOOD_WAIT') {
        report.skipped = items.slice(index + 1).map((i) => i.chatId);
        break;
      }
    }
  }
  return report;
}
