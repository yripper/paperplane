import type { IAuthKeysRepository } from '@mtcute/node';
import type { SecretStore } from '../secrets/keychain.js';

// Telegram production DCs. deleteAll can't enumerate Keychain items cheaply,
// so it clears every DC an account can have keys for.
const DC_IDS = [1, 2, 3, 4, 5];

const account = (dc: number): string => `authkey:${dc}`;

/// The permanent auth key is a full login token for the account, so it lives
/// in Keychain; mtcute keeps everything else (peers, update state) in SQLite.
/// Temp (PFS) keys are short-lived and re-negotiable, so memory is enough.
export class KeychainAuthKeys implements IAuthKeysRepository {
  private readonly cache = new Map<number, Uint8Array | null>();
  private readonly temp = new Map<string, { key: Uint8Array; expires: number }>();

  constructor(private readonly secrets: SecretStore) {}

  async set(dc: number, key: Uint8Array | null): Promise<void> {
    if (key === null) await this.secrets.delete(account(dc));
    else await this.secrets.set(account(dc), Buffer.from(key).toString('base64'));
    this.cache.set(dc, key);
  }

  async get(dc: number): Promise<Uint8Array | null> {
    if (this.cache.has(dc)) return this.cache.get(dc) ?? null;
    const stored = await this.secrets.get(account(dc));
    const key = stored === null ? null : new Uint8Array(Buffer.from(stored, 'base64'));
    this.cache.set(dc, key);
    return key;
  }

  setTemp(dc: number, idx: number, key: Uint8Array | null, expires: number): void {
    if (key === null) this.temp.delete(`${dc}:${idx}`);
    else this.temp.set(`${dc}:${idx}`, { key, expires });
  }

  getTemp(dc: number, idx: number, now: number): Uint8Array | null {
    const entry = this.temp.get(`${dc}:${idx}`);
    return entry && entry.expires > now ? entry.key : null;
  }

  async deleteByDc(dc: number): Promise<void> {
    await this.set(dc, null);
    for (const k of [...this.temp.keys()]) if (k.startsWith(`${dc}:`)) this.temp.delete(k);
  }

  async deleteAll(): Promise<void> {
    for (const dc of DC_IDS) await this.set(dc, null);
    this.temp.clear();
  }
}
