import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { AppError } from '../domain/errors.js';

const hasCode = (e: unknown, code: string): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === code;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return hasCode(e, 'EPERM'); // exists but owned by someone else
  }
}

/// Two processes on one Telegram session cause AUTH_KEY_DUPLICATED, so the
/// daemon and `paperplane login/logout` all take this lock.
export function acquireLock(path: string, pid: number = process.pid): { release(): void } {
  try {
    writeFileSync(path, String(pid), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (!hasCode(e, 'EEXIST')) throw e;
    const holder = Number(readFileSync(path, 'utf8'));
    // pid 0 (empty/garbage file) would make kill(0, 0) report "alive" forever.
    if (Number.isInteger(holder) && holder > 0 && holder !== pid && isAlive(holder)) {
      throw new AppError('INTERNAL', `paperplane is already running (pid ${holder}); stop it first (pm2 stop paperplane)`);
    }
    writeFileSync(path, String(pid), { mode: 0o600 }); // stale lock from a crash
  }
  return {
    release: () => {
      try {
        if (readFileSync(path, 'utf8') === String(pid)) unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
}
