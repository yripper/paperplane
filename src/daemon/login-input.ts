import { AppError } from '../domain/errors.js';

/// Pure parts of `paperplane login`'s credential prompts, kept out of cli.ts
/// so the "Enter keeps the stored value" rules are testable without a TTY.

export function apiIdPrompt(stored: number | undefined): string {
  return stored === undefined ? 'api_id (from https://my.telegram.org): ' : `api_id (from https://my.telegram.org) [${stored}]: `;
}

// The stored api_hash is a secret, so the prompt never echoes it.
export function apiHashPrompt(hasStored: boolean): string {
  return hasStored ? 'api_hash (press Enter to keep current): ' : 'api_hash: ';
}

export function pickApiId(input: string, stored: number | undefined): number {
  const trimmed = input.trim();
  const apiId = trimmed === '' && stored !== undefined ? stored : Number(trimmed === '' ? Number.NaN : trimmed);
  if (!Number.isInteger(apiId) || apiId <= 0) throw new AppError('VALIDATION', 'api_id must be a positive integer');
  return apiId;
}

export function pickApiHash(input: string, stored: string | null): string {
  const trimmed = input.trim();
  if (trimmed !== '') return trimmed;
  if (stored) return stored;
  throw new AppError('VALIDATION', 'api_hash must not be empty');
}
