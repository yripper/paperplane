import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TgMedia } from '../telegram/types.js';
import { type ActionDeps, requireChat } from './context.js';

/// Downloads go fully into memory (mtcute downloadAsBuffer), so cap them.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/x-tgsticker': 'tgs',
  'text/plain': 'txt',
};
const KIND_EXTENSIONS: Record<string, string> = { photo: 'jpg', voice: 'ogg' };

export interface SavedMedia {
  path: string;
  /** null on a cache hit: only the file is kept, not Telegram's metadata. */
  kind: string | null;
  mimeType: string | null;
  size: number;
  /** True when the file was already on disk and Telegram wasn't called. */
  cached: boolean;
}

/// Only an extension is taken from the sender-controlled file name, never the
/// name itself, so it can't steer the path out of the media directory.
export function mediaExtension(m: Pick<TgMedia, 'kind' | 'mimeType' | 'fileName'>): string {
  const fromName = m.fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  return (m.mimeType && MIME_EXTENSIONS[m.mimeType]) || KIND_EXTENSIONS[m.kind] || 'bin';
}

/// The extension isn't known until the file is downloaded, so a cached copy
/// is found by its "<msgId>." prefix.
function findCached(dir: string, messageId: number): string | null {
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => f.startsWith(`${messageId}.`));
  return name ? join(dir, name) : null;
}

/// 0700/0600 like ~/.paperplane itself: these are other people's photos and voice notes.
function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export async function downloadMedia(d: ActionDeps, input: { chatId: number; messageId: number }): Promise<SavedMedia> {
  const chat = requireChat(d, input.chatId);
  const dir = join(d.mediaDir, String(chat.id));
  const cached = findCached(dir, input.messageId);
  if (cached) return { path: cached, kind: null, mimeType: null, size: statSync(cached).size, cached: true };

  const media = await d.gateway.downloadMedia(chat.id, input.messageId, MAX_MEDIA_BYTES);
  ensurePrivateDir(dir);
  const path = join(dir, `${input.messageId}.${mediaExtension(media)}`);
  writeFileSync(path, media.bytes, { mode: 0o600 });
  return { path, kind: media.kind, mimeType: media.mimeType, size: media.bytes.length, cached: false };
}
