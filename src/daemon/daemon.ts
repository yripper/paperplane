import { randomUUID } from 'node:crypto';
import type { ActionDeps } from '../actions/context.js';
import { loadConfig, requireApiId } from '../config/config.js';
import { ensureHome, resolvePaths } from '../config/paths.js';
import { AppError, describeError } from '../domain/errors.js';
import { PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import { startHttpServer } from '../mcp/http.js';
import { buildServer, type StatusReport } from '../mcp/server.js';
import { Keychain, SECRET_ACCOUNTS } from '../secrets/keychain.js';
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
import { createSession } from '../telegram/session.js';
import { acquireLock } from './lock.js';
import { createLogger } from './logger.js';
import { startNonOverlappingLoop } from './loop.js';
import { ensureBearerToken } from './token.js';

const nowSec = (): number => Math.floor(Date.now() / 1000);
const isoOrNull = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());

export async function startDaemon(): Promise<void> {
  const log = createLogger();
  const paths = resolvePaths();
  ensureHome(paths);
  const config = loadConfig(paths.config);
  const apiId = requireApiId(config);
  const lock = acquireLock(paths.lock);

  const keychain = new Keychain();
  const apiHash = await keychain.get(SECRET_ACCOUNTS.apiHash);
  if (!apiHash) throw new AppError('AUTH_REQUIRED', 'api_hash missing from Keychain: run `paperplane login`');
  const token = await ensureBearerToken(keychain);

  const db = openDb(paths.db);
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

  const session = createSession(
    {
      apiId,
      apiHash,
      mtcuteDbPath: paths.mtcuteDb,
      authKeys: new KeychainAuthKeys(keychain),
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
  const gateway = session.gateway;

  state.auth = await session.connect();
  if (state.auth === 'auth_required') log.error('not logged in: run `paperplane login`, then `pm2 restart paperplane`');

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
  // First sweep runs right away (it also seeds mtcute's peer cache) but in the
  // background: with thousands of dialogs it can take minutes.
  void syncOnce().catch((e: unknown) => log.warn(`initial sync failed: ${describeError(e)}`));
  const stopLoop = startNonOverlappingLoop(syncOnce, config.sweepIntervalSec * 1000, (e) =>
    log.warn(`sync failed: ${describeError(e)}`),
  );

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
  log.info(`paperplane listening on http://127.0.0.1:${http.port}/mcp (telegram auth: ${state.auth})`);

  // A clean mtcute shutdown matters: an unclean storage close makes catchUp
  // replay duplicates (harmless, but noisy). pm2's kill_timeout allows for it.
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: shutting down`);
    stopLoop();
    await http.close();
    await session.destroy().catch((e: unknown) => log.warn(`mtcute close failed: ${describeError(e)}`));
    db.close();
    lock.release();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
