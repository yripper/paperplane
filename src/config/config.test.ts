import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { loadConfig, requireApiId, saveConfig } from './config.js';

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'pp-cfg-')), 'config.json');

describe('loadConfig', () => {
  it('returns defaults when the file is missing', () => {
    const c = loadConfig('/nonexistent/config.json');
    expect(c.port).toBe(7777);
    expect(c.sweepIntervalSec).toBe(180);
    expect(c.defaultWatchLevel.channel).toBe('muted');
    expect(c.defaultWatchLevel.user).toBe('normal');
    expect(c.apiId).toBeUndefined();
  });

  it('merges file values over defaults', () => {
    const f = tmpFile();
    writeFileSync(f, JSON.stringify({ port: 8000, apiId: 123 }));
    const c = loadConfig(f);
    expect(c.port).toBe(8000);
    expect(c.apiId).toBe(123);
    expect(c.sendsPerMinute).toBe(20);
  });

  it('rejects out-of-range values with VALIDATION', () => {
    const f = tmpFile();
    writeFileSync(f, JSON.stringify({ port: 80 }));
    expect(() => loadConfig(f)).toThrow(AppError);
  });

  it('rejects malformed JSON with VALIDATION', () => {
    const f = tmpFile();
    writeFileSync(f, '{ nope');
    expect(() => loadConfig(f)).toThrowError(/not valid JSON/);
  });
});

describe('saveConfig', () => {
  it('round-trips and writes the file as 0600', () => {
    const f = tmpFile();
    const c = { ...loadConfig('/nonexistent'), apiId: 42 };
    saveConfig(f, c);
    expect(loadConfig(f)).toEqual(c);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe('requireApiId', () => {
  it('throws VALIDATION when apiId is missing', () => {
    expect(() => requireApiId(loadConfig('/nonexistent'))).toThrowError(/paperplane login/);
  });
});
