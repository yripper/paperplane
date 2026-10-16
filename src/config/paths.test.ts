import { mkdtempSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureHome, resolvePaths } from './paths.js';

describe('resolvePaths', () => {
  it('defaults to ~/.paperplane', () => {
    expect(resolvePaths({}).home).toBe(join(homedir(), '.paperplane'));
  });

  it('honors PAPERPLANE_HOME and derives every file from it', () => {
    expect(resolvePaths({ PAPERPLANE_HOME: '/x/pp' })).toEqual({
      home: '/x/pp',
      config: '/x/pp/config.json',
      db: '/x/pp/paperplane.db',
      mtcuteDb: '/x/pp/mtcute.db',
      lock: '/x/pp/paperplane.lock',
    });
  });
});

describe('ensureHome', () => {
  it('creates the directory with mode 0700', () => {
    const paths = resolvePaths({ PAPERPLANE_HOME: join(mkdtempSync(join(tmpdir(), 'pp-')), 'home') });
    ensureHome(paths);
    expect(statSync(paths.home).mode & 0o777).toBe(0o700);
  });
});
