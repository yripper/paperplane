export type ConnectResult = 'ok' | 'auth_required';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConnectorOptions {
  attempt: () => Promise<ConnectResult>;
  /// Final outcome: 'ok' or 'auth_required'. Neither is retried: retrying a
  /// missing login can't help, the user has to run `paperplane login`.
  onResult: (r: ConnectResult) => void;
  onError: (e: unknown, retryInMs: number) => void;
  timers: Timers;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export const CONNECT_RETRY_INITIAL_MS = 5000;
export const CONNECT_RETRY_MAX_MS = 60_000;

/// Connects in the background so HTTP and store reads never wait on Telegram.
/// A non-auth failure (network, DC trouble) must not exit the process (pm2
/// would crash-loop), so it retries with capped doubling backoff until stopped.
export function startConnector(o: ConnectorOptions): { stop(): void } {
  const maxMs = o.maxDelayMs ?? CONNECT_RETRY_MAX_MS;
  let delayMs = o.initialDelayMs ?? CONNECT_RETRY_INITIAL_MS;
  let stopped = false;
  let timer: unknown = null;

  const run = (): void => {
    timer = null;
    o.attempt().then(
      (r) => {
        if (!stopped) o.onResult(r);
      },
      (e: unknown) => {
        // After stop, the failure is usually the daemon destroying the client on shutdown.
        if (stopped) return;
        const wait = delayMs;
        delayMs = Math.min(delayMs * 2, maxMs);
        o.onError(e, wait);
        timer = o.timers.setTimeout(run, wait);
      },
    );
  };
  run();

  return {
    stop() {
      stopped = true;
      if (timer !== null) o.timers.clearTimeout(timer);
      timer = null;
    },
  };
}
