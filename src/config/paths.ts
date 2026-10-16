import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppPaths {
  home: string;
  config: string;
  db: string;
  mtcuteDb: string;
  lock: string;
  style: string;
}

/// Every on-disk location derives from one root so backing up ~/.paperplane
/// backs up everything.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const home = env.PAPERPLANE_HOME ?? join(homedir(), '.paperplane');
  return {
    home,
    config: join(home, 'config.json'),
    db: join(home, 'paperplane.db'),
    mtcuteDb: join(home, 'mtcute.db'),
    lock: join(home, 'paperplane.lock'),
    style: join(home, 'style.md'),
  };
}

/// 0700 because the directory holds the message store and mtcute's peer cache.
/// chmod after mkdir: `mode` is ignored when the directory already exists.
export function ensureHome(paths: AppPaths): void {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  chmodSync(paths.home, 0o700);
}
