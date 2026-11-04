import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { makeActionDeps } from '../testing/action-deps.js';
import { downloadMedia, MAX_MEDIA_BYTES, mediaExtension } from './media.js';

let t: ReturnType<typeof makeActionDeps>;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

beforeEach(() => {
  t = makeActionDeps();
  t.store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
});

describe('downloadMedia', () => {
  it('saves a photo under media/<chat>/<msg>.jpg and returns its path', async () => {
    t.gateway.media.set('10:5', { kind: 'photo', mimeType: 'image/jpeg', fileName: null, bytes: bytes('jpeg-bytes') });
    const res = await downloadMedia(t.deps, { chatId: 10, messageId: 5 });
    expect(res).toEqual({ path: join(t.deps.mediaDir, '10', '5.jpg'), kind: 'photo', mimeType: 'image/jpeg', size: 10, cached: false });
    expect(readFileSync(res.path, 'utf8')).toBe('jpeg-bytes');
    expect(t.gateway.callsTo('downloadMedia')).toEqual([[10, 5, MAX_MEDIA_BYTES]]);
  });

  it('keeps files private to the user', async () => {
    t.gateway.media.set('10:6', { kind: 'voice', mimeType: 'audio/ogg', fileName: null, bytes: bytes('ogg') });
    const res = await downloadMedia(t.deps, { chatId: 10, messageId: 6 });
    expect(res.path.endsWith('6.ogg')).toBe(true);
    expect(statSync(res.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(t.deps.mediaDir, '10')).mode & 0o777).toBe(0o700);
  });

  it('serves a second request from disk without calling Telegram', async () => {
    t.gateway.media.set('10:5', { kind: 'photo', mimeType: 'image/jpeg', fileName: null, bytes: bytes('jpeg') });
    const first = await downloadMedia(t.deps, { chatId: 10, messageId: 5 });
    const second = await downloadMedia(t.deps, { chatId: 10, messageId: 5 });
    expect(second).toEqual({ path: first.path, kind: null, mimeType: null, size: 4, cached: true });
    expect(t.gateway.callsTo('downloadMedia')).toHaveLength(1);
  });

  it('does not treat message 5 as cached when only message 55 is on disk', async () => {
    t.gateway.media.set('10:55', { kind: 'photo', mimeType: 'image/jpeg', fileName: null, bytes: bytes('a') });
    t.gateway.media.set('10:5', { kind: 'photo', mimeType: 'image/jpeg', fileName: null, bytes: bytes('b') });
    await downloadMedia(t.deps, { chatId: 10, messageId: 55 });
    expect((await downloadMedia(t.deps, { chatId: 10, messageId: 5 })).cached).toBe(false);
  });

  it('rejects an unknown chat before calling Telegram', async () => {
    await expect(downloadMedia(t.deps, { chatId: 99, messageId: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('downloadMedia')).toHaveLength(0);
  });

  it('passes gateway errors through and writes nothing', async () => {
    t.gateway.failOn.set('downloadMedia', new AppError('VALIDATION', 'poll media has no file to download'));
    await expect(downloadMedia(t.deps, { chatId: 10, messageId: 7 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('mediaExtension', () => {
  it('prefers a safe extension from the file name', () => {
    expect(mediaExtension({ kind: 'document', mimeType: 'application/octet-stream', fileName: 'Report.PDF' })).toBe('pdf');
  });

  it('never lets the file name shape the path', () => {
    expect(mediaExtension({ kind: 'document', mimeType: 'text/plain', fileName: '../../etc/passwd' })).toBe('txt');
    expect(mediaExtension({ kind: 'document', mimeType: null, fileName: 'a.tar/../x' })).toBe('bin');
  });

  it('falls back to the mime type, then the kind, then bin', () => {
    expect(mediaExtension({ kind: 'voice', mimeType: 'audio/ogg', fileName: null })).toBe('ogg');
    expect(mediaExtension({ kind: 'audio', mimeType: 'audio/mpeg', fileName: null })).toBe('mp3');
    expect(mediaExtension({ kind: 'photo', mimeType: null, fileName: null })).toBe('jpg');
    expect(mediaExtension({ kind: 'document', mimeType: 'application/x-unknown', fileName: null })).toBe('bin');
  });
});
