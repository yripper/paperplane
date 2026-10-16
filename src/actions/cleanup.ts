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
  if (Object.values(criteria).every((v) => v === undefined)) {
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

export async function applyCleanupPlan(d: ActionDeps, planId: string, exclude: number[] = []): Promise<CleanupReport> {
  const plan = d.plans.get(planId);
  if (!plan) throw new AppError('NOT_FOUND', `unknown cleanup plan ${planId}`);
  if (plan.expiresAt <= d.now()) throw new AppError('VALIDATION', 'cleanup plan expired: create a new one');
  if (plan.status !== 'draft' || !d.plans.markApplied(planId)) throw new AppError('VALIDATION', 'cleanup plan already applied');

  const items = plan.items.filter((i) => !exclude.includes(i.chatId));
  const report: CleanupReport = { done: [], failed: [], skipped: [] };

  if (plan.mode === 'archive') {
    const ids = items.map((i) => i.chatId);
    acquire(d.limits.destructive.tryAcquire());
    await audited(d, 'cleanup_archive', null, () => d.gateway.archive(ids));
    d.chats.setArchived(ids, true, d.now());
    report.done = ids;
    return report;
  }

  for (const [index, item] of items.entries()) {
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
      const code: ErrorCode = e instanceof AppError ? e.code : 'INTERNAL';
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
