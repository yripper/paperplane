import { describe, expect, it } from 'vitest';
import { type ConnectResult, startConnector, type Timers } from './connector.js';

/// Manual timer queue: tests decide exactly when each scheduled retry fires.
function fakeTimers(): Timers & { pending: { fn: () => void; ms: number; id: number }[]; fire(): void } {
  let next = 0;
  const pending: { fn: () => void; ms: number; id: number }[] = [];
  return {
    pending,
    setTimeout(fn: () => void, ms: number): unknown {
      const id = ++next;
      pending.push({ fn, ms, id });
      return id;
    },
    clearTimeout(handle: unknown): void {
      const i = pending.findIndex((p) => p.id === handle);
      if (i >= 0) pending.splice(i, 1);
    },
    fire(): void {
      const t = pending.shift();
      if (!t) throw new Error('no timer pending');
      t.fn();
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function harness(results: (ConnectResult | Error)[]) {
  const timers = fakeTimers();
  const events: string[] = [];
  let attempts = 0;
  const connector = startConnector({
    attempt: async () => {
      const r = results[attempts++];
      if (r === undefined) return new Promise<ConnectResult>(() => {}); // hangs, like mtcute offline
      if (r instanceof Error) throw r;
      return r;
    },
    onResult: (r) => events.push(r),
    onError: (_e, retryInMs) => events.push(`error:${retryInMs}`),
    timers,
  });
  return { timers, events, connector, attempts: () => attempts };
}

describe('startConnector', () => {
  it('reports ok after one attempt and schedules nothing', async () => {
    const h = harness(['ok']);
    await flush();
    expect(h.events).toEqual(['ok']);
    expect(h.timers.pending).toHaveLength(0);
  });

  it('reports auth_required without retrying', async () => {
    const h = harness(['auth_required']);
    await flush();
    expect(h.events).toEqual(['auth_required']);
    expect(h.timers.pending).toHaveLength(0);
  });

  it('retries errors with capped doubling backoff, then reports ok', async () => {
    const h = harness([new Error('net'), new Error('net'), new Error('net'), new Error('net'), new Error('net'), 'ok']);
    for (let i = 0; i < 5; i++) {
      await flush();
      h.timers.fire();
    }
    await flush();
    expect(h.events).toEqual(['error:5000', 'error:10000', 'error:20000', 'error:40000', 'error:60000', 'ok']);
    expect(h.attempts()).toBe(6);
    expect(h.timers.pending).toHaveLength(0);
  });

  it('stop cancels a scheduled retry', async () => {
    const h = harness([new Error('net'), 'ok']);
    await flush();
    expect(h.timers.pending).toHaveLength(1);
    h.connector.stop();
    expect(h.timers.pending).toHaveLength(0);
    expect(h.attempts()).toBe(1);
  });

  it('ignores the result of an attempt that settles after stop', async () => {
    let settle: (r: ConnectResult) => void = () => {};
    const timers = fakeTimers();
    const events: string[] = [];
    const c = startConnector({
      attempt: () => new Promise<ConnectResult>((r) => (settle = r)),
      onResult: (r) => events.push(r),
      onError: () => events.push('error'),
      timers,
    });
    c.stop();
    settle('ok');
    await flush();
    expect(events).toEqual([]);
  });

  it('ignores an error that arrives after stop and schedules no retry', async () => {
    let fail: (e: Error) => void = () => {};
    const timers = fakeTimers();
    const events: string[] = [];
    const c = startConnector({
      attempt: () => new Promise<ConnectResult>((_r, rej) => (fail = rej)),
      onResult: (r) => events.push(r),
      onError: () => events.push('error'),
      timers,
    });
    c.stop();
    fail(new Error('destroyed'));
    await flush();
    expect(events).toEqual([]);
    expect(timers.pending).toHaveLength(0);
  });
});
