import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../testing/memory-secrets.js';
import { KeychainAuthKeys } from './keychain-auth-keys.js';

const key = new Uint8Array([1, 2, 3]);

describe('KeychainAuthKeys', () => {
  it('stores permanent keys as base64 under authkey:<dc>', async () => {
    const secrets = new MemorySecretStore();
    await new KeychainAuthKeys(secrets).set(2, key);
    expect(secrets.items.get('authkey:2')).toBe('AQID');
  });

  it('reads keys written by a previous process', async () => {
    const secrets = new MemorySecretStore();
    await new KeychainAuthKeys(secrets).set(2, key);
    expect(await new KeychainAuthKeys(secrets).get(2)).toEqual(key);
  });

  it('returns null for an unknown DC', async () => {
    expect(await new KeychainAuthKeys(new MemorySecretStore()).get(4)).toBeNull();
  });

  it('set(dc, null) deletes the key', async () => {
    const secrets = new MemorySecretStore();
    const repo = new KeychainAuthKeys(secrets);
    await repo.set(2, key);
    await repo.set(2, null);
    expect(secrets.items.has('authkey:2')).toBe(false);
    expect(await repo.get(2)).toBeNull();
  });

  it('keeps temp keys in memory only and honors expiry', async () => {
    const secrets = new MemorySecretStore();
    const repo = new KeychainAuthKeys(secrets);
    await repo.setTemp(2, 0, key, 100);
    expect(await repo.getTemp(2, 0, 50)).toEqual(key);
    expect(await repo.getTemp(2, 0, 150)).toBeNull();
    expect(secrets.items.size).toBe(0);
  });

  it('deleteByDc removes permanent and temp keys for that DC', async () => {
    const repo = new KeychainAuthKeys(new MemorySecretStore());
    await repo.set(2, key);
    await repo.setTemp(2, 0, key, 100);
    await repo.deleteByDc(2);
    expect(await repo.get(2)).toBeNull();
    expect(await repo.getTemp(2, 0, 50)).toBeNull();
  });

  it('deleteAll removes keys for every production DC', async () => {
    const secrets = new MemorySecretStore();
    const repo = new KeychainAuthKeys(secrets);
    await repo.set(1, key);
    await repo.set(5, key);
    await repo.deleteAll();
    expect(secrets.items.size).toBe(0);
  });
});
