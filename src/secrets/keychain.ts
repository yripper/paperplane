import { AppError } from '../domain/errors.js';
import { type CommandRunner, cliRunner } from './runner.js';

export type { CommandRunner } from './runner.js';

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export const SECRET_ACCOUNTS = { apiHash: 'api_hash', bearerToken: 'bearer_token' } as const;

const SERVICE = 'paperplane';
// security(1) exit status for errSecItemNotFound.
const ITEM_NOT_FOUND = 44;
// Values are interpolated into a `security -i` command line, so only allow
// characters that can't start a new argument or command (base64, hex, tokens).
const SAFE_VALUE = /^[A-Za-z0-9+/=_.:-]+$/;

export const securityCli: CommandRunner = cliRunner(
  '/usr/bin/security',
  '/usr/bin/security not found: the Keychain backend only works on macOS',
);

/// macOS Keychain via the built-in `security` CLI, so there's no native
/// dependency. Writes go through `security -i` on stdin: secrets never appear
/// in argv, where any local process could read them from the process list.
export class Keychain implements SecretStore {
  constructor(
    private readonly runner: CommandRunner = securityCli,
    private readonly service: string = SERVICE,
  ) {}

  async get(account: string): Promise<string | null> {
    const r = await this.runner.run(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (r.code === ITEM_NOT_FOUND) return null;
    if (r.code !== 0) throw new AppError('INTERNAL', `keychain read failed for ${account} (exit ${r.code})`);
    return r.stdout.replace(/\n$/, '');
  }

  async set(account: string, value: string): Promise<void> {
    assertSafeSecret(account);
    assertSafeSecret(value);
    const r = await this.runner.run(['-i'], `add-generic-password -U -s ${this.service} -a ${account} -w ${value}\n`);
    if (r.code !== 0) throw new AppError('INTERNAL', `keychain write failed for ${account} (exit ${r.code})`);
  }

  async delete(account: string): Promise<void> {
    const r = await this.runner.run(['delete-generic-password', '-s', this.service, '-a', account]);
    if (r.code !== 0 && r.code !== ITEM_NOT_FOUND) {
      throw new AppError('INTERNAL', `keychain delete failed for ${account} (exit ${r.code})`);
    }
  }
}

/// Shared by every backend so a value stored on one platform is valid on all.
export function assertSafeSecret(value: string): void {
  if (!SAFE_VALUE.test(value)) throw new AppError('VALIDATION', 'keychain values must be base64/hex/token characters');
}
