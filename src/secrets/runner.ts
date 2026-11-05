import { spawn } from 'node:child_process';
import { AppError } from '../domain/errors.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(args: string[], stdin?: string): Promise<CommandResult>;
}

const isMissingBinary = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'ENOENT';

/// Runs `binary` with args, writing `stdin` (if any) and collecting output.
/// A missing binary rejects with `INTERNAL: <missingHint>` instead of a raw
/// ENOENT, so the user is told what to install.
/// `env` is resolved per call (default: inherit), so a value computed from the
/// live environment stays current.
export function cliRunner(binary: string, missingHint: string, env?: () => NodeJS.ProcessEnv): CommandRunner {
  return {
    run(args: string[], stdin?: string) {
      return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env?.() });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', (e: unknown) => reject(isMissingBinary(e) ? new AppError('INTERNAL', missingHint) : e));
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
        // EPIPE when the tool exits before reading stdin (or never started)
        // would otherwise be an uncaught 'error' event; the close/error
        // handlers already report the failure.
        child.stdin.on('error', () => {});
        child.stdin.end(stdin ?? '');
      });
    },
  };
}
