import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import type { CommandResult, CommandRunner } from './runner.js';
import { SecretTool, withSessionBus } from './secret-tool.js';

class FakeRunner implements CommandRunner {
  readonly calls: { args: string[]; stdin?: string }[] = [];
  constructor(private readonly result: CommandResult) {}
  async run(args: string[], stdin?: string) {
    this.calls.push({ args, stdin });
    return this.result;
  }
}

const result = (code: number, stdout = '', stderr = ''): FakeRunner => new FakeRunner({ code, stdout, stderr });

describe('SecretTool', () => {
  it('get looks the item up by service and account', async () => {
    const runner = result(0, 's3cr3t');
    expect(await new SecretTool(runner).get('api_hash')).toBe('s3cr3t');
    expect(runner.calls[0]?.args).toEqual(['lookup', 'service', 'paperplane', 'account', 'api_hash']);
  });

  it('get strips one trailing newline', async () => {
    expect(await new SecretTool(result(0, 'abc\n')).get('x')).toBe('abc');
  });

  it('get returns null when nothing matches (exit 1, no output)', async () => {
    expect(await new SecretTool(result(1)).get('x')).toBeNull();
  });

  it('get returns null on empty output', async () => {
    expect(await new SecretTool(result(0, '')).get('x')).toBeNull();
  });

  it('get throws INTERNAL when the keyring is unreachable, without echoing stderr', async () => {
    const err = await new SecretTool(result(1, '', 'Cannot autolaunch D-Bus')).get('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'INTERNAL' });
    expect((err as AppError).message).not.toContain('autolaunch');
  });

  it('set sends the secret through stdin, never argv', async () => {
    const runner = result(0);
    await new SecretTool(runner).set('api_hash', 'abc+/=123');
    expect(runner.calls[0]?.args).toEqual([
      'store',
      '--label=paperplane api_hash',
      'service',
      'paperplane',
      'account',
      'api_hash',
    ]);
    expect(runner.calls[0]?.stdin).toBe('abc+/=123');
    expect(runner.calls[0]?.args.join(' ')).not.toContain('abc+/=123');
  });

  it('set uses the injected service name', async () => {
    const runner = result(0);
    await new SecretTool(runner, 'paperplane-test').set('it', 'v1');
    expect(runner.calls[0]?.args).toEqual(['store', '--label=paperplane-test it', 'service', 'paperplane-test', 'account', 'it']);
  });

  it('set rejects values outside the shared safe charset', async () => {
    const runner = result(0);
    await expect(new SecretTool(runner).set('api_hash', 'a b')).rejects.toBeInstanceOf(AppError);
    await expect(new SecretTool(runner).set('api_hash', 'a\nb')).rejects.toBeInstanceOf(AppError);
    await expect(new SecretTool(runner).set('a b', 'ok')).rejects.toBeInstanceOf(AppError);
    expect(runner.calls).toHaveLength(0);
  });

  it('set throws INTERNAL when secret-tool exits non-zero, without the value in the message', async () => {
    const err = await new SecretTool(result(1, '', 'locked')).set('api_hash', 'topsecret').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INTERNAL' });
    expect((err as AppError).message).not.toContain('topsecret');
  });

  it('delete clears by service and account', async () => {
    const runner = result(0);
    await new SecretTool(runner).delete('bearer_token');
    expect(runner.calls[0]?.args).toEqual(['clear', 'service', 'paperplane', 'account', 'bearer_token']);
  });

  it('delete treats nothing-to-clear as success', async () => {
    await expect(new SecretTool(result(1)).delete('x')).resolves.toBeUndefined();
  });

  it('delete throws INTERNAL when the keyring is unreachable', async () => {
    await expect(new SecretTool(result(1, '', 'no D-Bus')).delete('x')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('withSessionBus', () => {
  const exists = (): boolean => true;

  it('points DBUS_SESSION_BUS_ADDRESS at the user session bus when it is missing', () => {
    expect(withSessionBus({ HOME: '/h' }, 1000, exists)).toEqual({
      HOME: '/h',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    });
  });

  it('never overrides an address the user set', () => {
    const env = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/custom' };
    expect(withSessionBus(env, 1000, exists)).toBe(env);
  });

  it('leaves the env alone when the socket does not exist or uid is unknown', () => {
    const env = { HOME: '/h' };
    expect(withSessionBus(env, 1000, () => false)).toBe(env);
    expect(withSessionBus(env, undefined, exists)).toBe(env);
  });
});

// Opt-in: touches the real Secret Service keyring under a throwaway service name.
describe.runIf(process.env.PAPERPLANE_SECRET_TOOL_IT === '1')('SecretTool (real)', () => {
  it('round-trips through secret-tool', async () => {
    const st = new SecretTool(undefined, 'paperplane-test');
    await st.set('it', 'v1+/=');
    expect(await st.get('it')).toBe('v1+/=');
    await st.delete('it');
    expect(await st.get('it')).toBeNull();
  });
});
