import type { ActionDeps } from '../actions/context.js';
import { PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import { AuditRepo } from '../store/audit-repo.js';
import { CleanupPlansRepo } from '../store/cleanup-plans-repo.js';
import { FakeGateway } from './fake-gateway.js';
import { makeSink, makeStore, type TestStore } from './fixtures.js';

export function makeActionDeps(over: { sendsPerMinute?: number; destructivePerMinute?: number } = {}): {
  deps: ActionDeps;
  gateway: FakeGateway;
  store: TestStore;
  audit: AuditRepo;
  clock: { ms: number };
} {
  const store = makeStore();
  const gateway = new FakeGateway();
  // ~115 days after the epoch, so "inactive for N days" criteria have room to match.
  const clock = { ms: 10_000_000_000 };
  const nowMs = (): number => clock.ms;
  const nowSec = (): number => Math.floor(clock.ms / 1000);
  const audit = new AuditRepo(store.db);
  let ids = 0;
  const deps: ActionDeps = {
    gateway,
    sink: makeSink(store, nowSec),
    chats: store.chats,
    messages: store.messages,
    audit,
    plans: new CleanupPlansRepo(store.db),
    limits: {
      sends: new RateLimiter(over.sendsPerMinute ?? 20, 60_000, nowMs),
      chatGap: new PerKeyGap(1000, nowMs),
      destructive: new RateLimiter(over.destructivePerMinute ?? 30, 60_000, nowMs),
    },
    now: nowSec,
    newId: () => `plan-${++ids}`,
  };
  return { deps, gateway, store, audit, clock };
}
