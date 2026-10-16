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

  it('rejects criteria that narrow nothing', () => {
    expect(() => createCleanupPlan(t.deps, { mutedOnly: false }, 'remove')).toThrow(AppError);
    expect(() => createCleanupPlan(t.deps, { archivedOnly: false }, 'remove')).toThrow(AppError);
    expect(() => createCleanupPlan(t.deps, { types: [] }, 'remove')).toThrow(AppError);
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

  it('leaves an archive plan re-appliable when rate limited', async () => {
    const limited = makeActionDeps({ destructivePerMinute: 1 });
    limited.store.chats.ensure({ id: 1, type: 'user', title: 'Chat 1', username: null }, 'normal', 0);
    const plan = createCleanupPlan(limited.deps, { inactiveDays: 30 }, 'archive');
    expect(limited.deps.limits.destructive.tryAcquire().ok).toBe(true);
    await expect(applyCleanupPlan(limited.deps, plan.id)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.deps.plans.get(plan.id)?.status).toBe('draft');
    limited.clock.ms += 61_000;
    expect((await applyCleanupPlan(limited.deps, plan.id)).done).toEqual([1]);
  });

  it('reports an archive gateway failure instead of throwing', async () => {
    t.gateway.failOn.set('archive', new AppError('FORBIDDEN', 'nope'));
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'archive');
    const report = await applyCleanupPlan(t.deps, plan.id);
    expect(report).toEqual({
      done: [],
      failed: [{ chatId: 10, code: 'FORBIDDEN' }, { chatId: -1001, code: 'FORBIDDEN' }],
      skipped: [],
    });
  });

  it('makes no gateway call when everything is excluded', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'archive');
    const report = await applyCleanupPlan(t.deps, plan.id, [10, -1001]);
    expect(report).toEqual({ done: [], failed: [], skipped: [] });
    expect(t.gateway.callsTo('archive')).toHaveLength(0);
    expect(t.deps.plans.get(plan.id)?.status).toBe('applied');
  });

  it('re-checks items: missing chats fail NOT_FOUND, newly full chats FORBIDDEN, with no Telegram call', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'remove');
    t.store.chats.purge(10);
    t.store.chats.setWatchLevel(-1001, 'full', 0);
    const report = await applyCleanupPlan(t.deps, plan.id);
    expect(report).toEqual({
      done: [],
      failed: [{ chatId: 10, code: 'NOT_FOUND' }, { chatId: -1001, code: 'FORBIDDEN' }],
      skipped: [],
    });
    expect(t.gateway.calls).toHaveLength(0);
  });

  it('filters re-check failures out of the archive call', async () => {
    const plan = createCleanupPlan(t.deps, { inactiveDays: 30 }, 'archive');
    t.store.chats.purge(10);
    const report = await applyCleanupPlan(t.deps, plan.id);
    expect(t.gateway.callsTo('archive')).toEqual([[[-1001]]]);
    expect(report).toEqual({ done: [-1001], failed: [{ chatId: 10, code: 'NOT_FOUND' }], skipped: [] });
  });
});
