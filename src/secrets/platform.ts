import { AppError } from '../domain/errors.js';
import { Keychain, type SecretStore } from './keychain.js';
import { SecretTool } from './secret-tool.js';

/// The OS secret store for this machine: macOS Keychain or, on Linux, the
/// Secret Service keyring. There is deliberately no plaintext-file fallback.
export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === 'darwin') return new Keychain();
  if (platform === 'linux') return new SecretTool();
  throw new AppError('INTERNAL', `unsupported platform "${platform}": Paperplane runs on macOS and Linux`);
}
