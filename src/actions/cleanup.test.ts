import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { makeActionDeps } from '../testing/action-deps.js';
import { applyCleanupPlan, createCleanupPlan } from './cleanup.js';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps({ destructivePerMinute: 30 });
  t.store.chats.ensure({ id: 10, type: 'user', title: 'Old Contact', username: null }, 'normal', 0);
  t.store.chats.ensure({ id: -1001, type: 'channel', title: 'Old Channel', username: null }, 'muted', 0);
  t.store.chats.ensure({ id: 12, type: 'user', title: 'Best Friend', username: null }, 'full', 0);
});

describe('createCleanupPlan', () => {
  it('lists matching chats with their action and changes nothing', () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    expect(plan.items).toEqual([
      { chatId: 10, title: 'Old Contact', type: 'user', action: 'delete' },
      { chatId: -1001, title: 'Old Channel', type: 'channel', action: 'leave' },
    ]);
    expect(t.gateway.calls).toHaveLength(0);
  });

  it('requires at least one criterion', () => {
    expect(() => createCleanupPlan(t.deps, {}, 'remove')).toThrow(AppError);
  });
});

describe('applyCleanupPlan', () => {
  it('applies items except excluded ones and purges them', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    const report = await applyCleanupPlan(t.deps, plan.id, [-1001]);
    expect(report).toEqual({ done: [10], failed: [], skipped: [] });
    expect(t.store.chats.get(10)).toBeNull();
    expect(t.store.chats.get(-1001)).not.toBeNull();
  });

  it('refuses to apply twice', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    await applyCleanupPlan(t.deps, plan.id);
    await expect(applyCleanupPlan(t.deps, plan.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses expired plans', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    t.clock.ms += 31 * 60 * 1000;
    await expect(applyCleanupPlan(t.deps, plan.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('returns NOT_FOUND for unknown plans', async () => {
    await expect(applyCleanupPlan(t.deps, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stops at the rate limit and reports the rest as skipped', async () => {
    const limited = makeActionDeps({ destructivePerMinute: 1 });
    for (const id of [1, 2, 3]) limited.store.chats.ensure({ id, type: 'user', title: `Chat ${id}`, username: null }, 'normal', 0);
    const plan = createCleanupPlan(limited.deps, { inactiveDays: 30 }, 'remove');
    const report = await applyCleanupPlan(limited.deps, plan.id);
    expect(report.done).toHaveLength(1);
    expect(report.skipped).toHaveLength(2);
  });

  it('keeps going after a single failure', async () => {
    t.gateway.failOn.set('deleteChat', new AppError('FORBIDDEN', 'nope'));
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    const report = await applyCleanupPlan(t.deps, plan.id);
    expect(report.failed).toEqual([{ chatId: 10, code: 'FORBIDDEN' }]);
    expect(report.done).toEqual([-1001]);
  });

  it('archives everything in one call in archive mode', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'archive');
    const report = await applyCleanupPlan(t.deps, plan.id);
    expect(t.gateway.callsTo('archive')).toEqual([[[10, -1001]]]);
    expect(report.done).toEqual([10, -1001]);
    expect(t.store.chats.get(10)?.archived).toBe(true);
  });
});
