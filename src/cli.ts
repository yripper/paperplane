#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig, saveConfig } from './config/config.js';
import { ensureHome, resolvePaths } from './config/paths.js';
import { AppError, describeError } from './domain/errors.js';
import { startDaemon } from './daemon/daemon.js';
import { acquireLock } from './daemon/lock.js';
import { connectionSnippets } from './daemon/snippets.js';
import { ensureBearerToken } from './daemon/token.js';
import { Keychain, SECRET_ACCOUNTS } from './secrets/keychain.js';
import { KeychainAuthKeys } from './telegram/keychain-auth-keys.js';
import { login, logout } from './telegram/session.js';

const USAGE = `usage: paperplane <command>
  login    log in to Telegram (interactive) and store secrets in Keychain
  start    run the daemon (what pm2 runs)
  token    print the Claude Code / Claude Desktop connection setup
  logout   log out of Telegram and remove Paperplane's Keychain items`;

/// Hidden input mutes the readline output stream so passwords aren't echoed.
async function ask(question: string, hidden = false): Promise<string> {
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const rl = createInterface({ input: stdin, output: hidden ? muted : stdout, terminal: true });
  if (hidden) stdout.write(question);
  try {
    return (await rl.question(hidden ? '' : question)).trim();
  } finally {
    rl.close();
    if (hidden) stdout.write('\n');
  }
}

async function runLogin(): Promise<void> {
  const paths = resolvePaths();
  ensureHome(paths);
  const lock = acquireLock(paths.lock);
  try {
    const keychain = new Keychain();
    const config = loadConfig(paths.config);
    const apiId = config.apiId ?? Number(await ask('api_id (from https://my.telegram.org): '));
    if (!Number.isInteger(apiId) || apiId <= 0) throw new AppError('VALIDATION', 'api_id must be a positive integer');
    const apiHash = (await keychain.get(SECRET_ACCOUNTS.apiHash)) ?? (await ask('api_hash: ', true));
    if (apiHash.trim() === '') throw new AppError('VALIDATION', 'api_hash must not be empty');
    await keychain.set(SECRET_ACCOUNTS.apiHash, apiHash);
    saveConfig(paths.config, { ...config, apiId });

    const name = await login(
      { apiId, apiHash, mtcuteDbPath: paths.mtcuteDb, authKeys: new KeychainAuthKeys(keychain), log: () => {} },
      {
        phone: () => ask('phone number (international format, e.g. +56…): '),
        code: () => ask('login code (sent to your Telegram app): '),
        password: () => ask('2FA password: ', true),
      },
    );
    await ensureBearerToken(keychain);
    stdout.write(`Logged in as ${name}.\nNext: pnpm build && pm2 start ecosystem.config.cjs, then run \`paperplane token\`.\n`);
  } finally {
    lock.release();
  }
}

async function runToken(): Promise<void> {
  const paths = resolvePaths();
  const token = await ensureBearerToken(new Keychain());
  stdout.write(`${connectionSnippets(loadConfig(paths.config).port, token)}\n`);
}

async function runLogout(): Promise<void> {
  const paths = resolvePaths();
  const lock = acquireLock(paths.lock);
  try {
    const keychain = new Keychain();
    const config = loadConfig(paths.config);
    const apiHash = await keychain.get(SECRET_ACCOUNTS.apiHash);
    if (config.apiId !== undefined && apiHash) {
      await logout({ apiId: config.apiId, apiHash, mtcuteDbPath: paths.mtcuteDb, authKeys: new KeychainAuthKeys(keychain), log: () => {} });
    }
    await new KeychainAuthKeys(keychain).deleteAll();
    await keychain.delete(SECRET_ACCOUNTS.apiHash);
    await keychain.delete(SECRET_ACCOUNTS.bearerToken);
    stdout.write(`Logged out. Local data is still in ${paths.home}; delete it to remove everything.\n`);
  } finally {
    lock.release();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'login') return runLogin();
  if (command === 'start') return startDaemon();
  if (command === 'token') return runToken();
  if (command === 'logout') return runLogout();
  stdout.write(`${USAGE}\n`);
  process.exitCode = command ? 1 : 0;
}

main().catch((e: unknown) => {
  process.stderr.write(`${describeError(e)}\n`);
  process.exit(1);
});
