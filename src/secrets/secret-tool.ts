import { existsSync } from 'node:fs';
import { AppError } from '../domain/errors.js';
import { assertSafeSecret, type SecretStore } from './keychain.js';
import { type CommandResult, type CommandRunner, cliRunner } from './runner.js';

const SERVICE = 'paperplane';
export const SECRET_TOOL_MISSING_HINT =
  'secret-tool not found: Paperplane stores its secrets in the Secret Service keyring on Linux. Install it with `sudo apt install libsecret-tools`';
const KEYRING_HINT = 'is a Secret Service keyring (e.g. GNOME Keyring) running and unlocked in this D-Bus session?';

/// `pm2 startup` on Linux installs a systemd *system* unit that runs as the
/// user but without DBUS_SESSION_BUS_ADDRESS, so secret-tool can't find the
/// keyring after a reboot. When the variable is missing, point it at the
/// user's systemd session bus if that socket exists; never override a value
/// the user set.
export function withSessionBus(
  env: NodeJS.ProcessEnv,
  uid: number | undefined,
  exists: (path: string) => boolean,
): NodeJS.ProcessEnv {
  if (env.DBUS_SESSION_BUS_ADDRESS || uid === undefined) return env;
  const socket = `/run/user/${uid}/bus`;
  return exists(socket) ? { ...env, DBUS_SESSION_BUS_ADDRESS: `unix:path=${socket}` } : env;
}

export const secretToolCli: CommandRunner = cliRunner('secret-tool', SECRET_TOOL_MISSING_HINT, () =>
  withSessionBus(process.env, process.getuid?.(), existsSync),
);

/// secret-tool exits 1 with no output both for "no matching item" and, for
/// `clear`, "nothing to delete". Real failures (no D-Bus, locked keyring)
/// also exit 1 but print to stderr, so those must not read as "missing":
/// a silent null would make the daemon mint a new bearer token or report
/// auth_required when the keyring is just unreachable.
const isNoMatch = (r: CommandResult): boolean => r.code === 1 && r.stderr.trim() === '';

/// Linux backend: the freedesktop Secret Service (GNOME Keyring, KWallet)
/// through libsecret's `secret-tool`. Values go on stdin, never argv, so they
/// never show up in the process list.
export class SecretTool implements SecretStore {
  constructor(
    private readonly runner: CommandRunner = secretToolCli,
    private readonly service: string = SERVICE,
  ) {}

  async get(account: string): Promise<string | null> {
    const r = await this.runner.run(['lookup', 'service', this.service, 'account', account]);
    if (isNoMatch(r)) return null;
    if (r.code !== 0) throw new AppError('INTERNAL', `keyring read failed for ${account} (exit ${r.code}); ${KEYRING_HINT}`);
    const value = r.stdout.replace(/\n$/, '');
    return value === '' ? null : value;
  }

  async set(account: string, value: string): Promise<void> {
    assertSafeSecret(account);
    assertSafeSecret(value);
    const r = await this.runner.run(
      ['store', `--label=${this.service} ${account}`, 'service', this.service, 'account', account],
      value,
    );
    if (r.code !== 0) throw new AppError('INTERNAL', `keyring write failed for ${account} (exit ${r.code}); ${KEYRING_HINT}`);
  }

  async delete(account: string): Promise<void> {
    const r = await this.runner.run(['clear', 'service', this.service, 'account', account]);
    if (r.code !== 0 && !isNoMatch(r)) {
      throw new AppError('INTERNAL', `keyring delete failed for ${account} (exit ${r.code}); ${KEYRING_HINT}`);
    }
  }
}
