import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';

const watchLevel = z.enum(['full', 'normal', 'muted']);

export const configSchema = z.object({
  apiId: z.number().int().positive().optional(),
  port: z.number().int().min(1024).max(65535).default(7777),
  sweepIntervalSec: z.number().int().min(60).default(180),
  sendsPerMinute: z.number().int().min(1).default(20),
  destructivePerMinute: z.number().int().min(1).default(30),
  perChatSendGapMs: z.number().int().min(0).default(1000),
  // Full literal default: zod 4's .default() does not re-parse inner defaults.
  defaultWatchLevel: z
    .object({ user: watchLevel, bot: watchLevel, group: watchLevel, supergroup: watchLevel, channel: watchLevel })
    .default({ user: 'normal', bot: 'normal', group: 'normal', supergroup: 'normal', channel: 'muted' }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(path: string): Config {
  if (!existsSync(path)) return configSchema.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new AppError('VALIDATION', `config at ${path} is not valid JSON`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError('VALIDATION', `invalid config at ${path}: ${issues}`);
  }
  return parsed.data;
}

export function saveConfig(path: string, config: Config): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function requireApiId(config: Config): number {
  if (config.apiId === undefined) throw new AppError('VALIDATION', 'apiId missing: run `paperplane login` first');
  return config.apiId;
}
