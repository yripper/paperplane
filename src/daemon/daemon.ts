import { randomUUID } from 'node:crypto';
import type { ActionDeps } from '../actions/context.js';
import { type Config, loadConfig } from '../config/config.js';
import { type AppPaths, ensureHome, resolvePaths } from '../config/paths.js';
import { describeError } from '../domain/errors.js';
import { PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import { startHttpServer } from '../mcp/http.js';
import { buildServer, type StatusReport } from '../mcp/server.js';
import { Keychain, SECRET_ACCOUNTS, type SecretStore } from '../secrets/keychain.js';
import { AuditRepo } from '../store/audit-repo.js';
import { ChatsRepo } from '../store/chats-repo.js';
import { CleanupPlansRepo } from '../store/cleanup-plans-repo.js';
import { CursorsRepo } from '../store/cursors-repo.js';
import { openDb } from '../store/db.js';
import { LabelsRepo } from '../store/labels-repo.js';
import { MessagesRepo } from '../store/messages-repo.js';
import { backfillFullChats, type BackfillDeps } from '../sync/backfill.js';
import { runSweep, type SweepReport } from '../sync/sweep.js';
import { UpdateSink } from '../sync/update-sink.js';
import { KeychainAuthKeys } from '../telegram/keychain-auth-keys.js';
import type { TelegramGateway } from '../telegram/types.js';
import { createSession, type Session } from '../telegram/session.js';
import { decideAuthMode } from './auth-mode.js';
import { acquireLock } from './lock.js';
import { createLogger, type Logger } from './logger.js';
import { startNonOverlappingLoop } from './loop.js';
import { ensureBearerToken } from './token.js';
import { createUnauthenticatedGateway } from './unauthenticated-gateway.js';

const nowSec = (): number => Math.floor(Date.now() / 1000);
const isoOrNull = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());

// pm2's kill_timeout is 10 s; exit on our own just before it so a hung close
// can't leave the process half-dead.
const HARD_EXIT_MS = 8000;

interface Resources {
  stopLoop?: () => void;
  http?: { close(): Promise<void> };
  session?: Session;
  db?: { close(): unknown };
}

/// `secrets` is injectable so smoke tests never touch the real Keychain.
export async function startDaemon(secrets: SecretStore = new Keychain()): Promise<void> {
  const log = createLogger();
  const paths = resolvePaths();
  ensureHome(paths);
  const config = loadConfig(paths.config);
  const lock = acquireLock(paths.lock);

  // Every resource is optional: handlers are registered before startup so a
  // signal (or a startup failure) midway still releases whatever exists.
  const res: Resources = {};
  const cleanup = async (): Promise<void> => {
    res.stopLoop?.();
    await res.http?.close().catch((e: unknown) => log.warn(`http close failed: ${describeError(e)}`));
    await res.session?.destroy().catch((e: unknown) => log.warn(`mtcute close failed: ${describeError(e)}`));
    res.db?.close();
  };
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: shutting down`);
    setTimeout(() => process.exit(1), HARD_EXIT_MS).unref();
    try {
      await cleanup();
    } catch (e) {
      log.warn(`shutdown failed: ${describeError(e)}`);
    } finally {
      lock.release();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await runDaemon(secrets, log, paths, config, res);
  } catch (e) {
    stopping = true;
    await cleanup().catch(() => undefined);
    lock.release();
    throw e;
  }
}

async function runDaemon(secrets: SecretStore, log: Logger, paths: AppPaths, config: Config, res: Resources): Promise<void> {
  // A missing apiId/api_hash (before login, or after logout) must not exit:
  // pm2 would crash-loop. Stay up in auth_required so `status` still answers.
  const apiId = config.apiId;
  const apiHash = apiId === undefined ? null : await secrets.get(SECRET_ACCOUNTS.apiHash);
  const token = await ensureBearerToken(secrets);

  const db = openDb(paths.db);
  res.db = db;
  const chats = new ChatsRepo(db);
  const messages = new MessagesRepo(db);
  const labels = new LabelsRepo(db);
  const cursors = new CursorsRepo(db);
  const sink = new UpdateSink({ db, chats, messages, labels, watchDefaults: config.defaultWatchLevel, now: nowSec });

  const state: { auth: 'ok' | 'auth_required'; lastUpdateAt: number | null; lastSweepAt: number | null; lastSweep: SweepReport | null } = {
    auth: 'auth_required',
    lastUpdateAt: null,
    lastSweepAt: null,
    lastSweep: null,
  };

  let gateway: TelegramGateway = createUnauthenticatedGateway();
  const hasCredentials = decideAuthMode({ hasApiId: apiId !== undefined, hasApiHash: !!apiHash, connect: null }) === 'connect';
  if (hasCredentials && apiId !== undefined && apiHash) {
    const session = createSession(
      {
        apiId,
        apiHash,
        mtcuteDbPath: paths.mtcuteDb,
        authKeys: new KeychainAuthKeys(secrets),
        log: (level, tag, fmt) => (level <= 1 ? log.error({ tag }, fmt) : log.warn({ tag }, fmt)),
      },
      sink,
      {
        onUpdate: () => {
          state.lastUpdateAt = nowSec();
        },
        onUpdateError: (what, e) => log.warn(`update ${what} failed: ${describeError(e)}`),
        onClientError: (e) => log.error(`mtcute: ${describeError(e)}`),
      },
    );
    // Kept even when not logged in, only so shutdown can destroy it.
    res.session = session;
    state.auth = decideAuthMode({ hasApiId: true, hasApiHash: true, connect: await session.connect() }) === 'ok' ? 'ok' : 'auth_required';
    // Never call into an unauthorized mtcute client: it keeps the unauthenticated gateway.
    if (state.auth === 'ok') gateway = session.gateway;
  }
  if (state.auth === 'auth_required') log.warn('not logged in: run `paperplane login`, then `pm2 restart paperplane`');

  const backfill: BackfillDeps = { gateway, chats, messages, cursors, sink };
  const syncOnce = async (): Promise<void> => {
    if (state.auth !== 'ok') return;
    const report = await runSweep({ gateway, chats, sink, now: nowSec, log: (l) => log.warn(l) });
    state.lastSweep = report;
    state.lastSweepAt = nowSec();
    // Revoked from the phone (Settings → Devices): stop syncing, keep serving status.
    if (report.iterationError === 'AUTH_REQUIRED') {
      state.auth = 'auth_required';
      log.error('Telegram session revoked: run `paperplane login`, then `pm2 restart paperplane`');
      return;
    }
    await backfillFullChats({ ...backfill, log: (l) => log.warn(l) });
  };
  // The first sweep runs right away (it also seeds mtcute's peer cache) but in
  // the background, under the loop's in-flight guard so it can't overlap the
  // next tick: with thousands of dialogs it can take minutes.
  if (state.auth === 'ok') {
    res.stopLoop = startNonOverlappingLoop(syncOnce, config.sweepIntervalSec * 1000, (e) => log.warn(`sync failed: ${describeError(e)}`), {
      immediate: true,
    });
  }

  const actions: ActionDeps = {
    gateway,
    sink,
    chats,
    messages,
    audit: new AuditRepo(db),
    plans: new CleanupPlansRepo(db),
    limits: {
      sends: new RateLimiter(config.sendsPerMinute, 60_000),
      chatGap: new PerKeyGap(config.perChatSendGapMs),
      destructive: new RateLimiter(config.destructivePerMinute, 60_000),
    },
    now: nowSec,
    newId: () => randomUUID(),
  };
  const status = (): StatusReport => ({
    auth: state.auth,
    lastUpdateAt: isoOrNull(state.lastUpdateAt),
    lastSweepAt: isoOrNull(state.lastSweepAt),
    lastSweep: state.lastSweep,
    chats: chats.count(),
    messages: messages.count(),
  });

  const http = await startHttpServer({
    port: config.port,
    token,
    log: (l) => log.warn(l),
    buildServer: () => buildServer({ actions, db, labels, backfill, status }),
  });
  res.http = http;
  log.info(`paperplane listening on http://127.0.0.1:${http.port}/mcp (telegram auth: ${state.auth})`);
}
