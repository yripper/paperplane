import { describe, expect, it } from 'vitest';
import { Keychain } from './keychain.js';
import { createSecretStore } from './platform.js';
import { cliRunner } from './runner.js';
import { SECRET_TOOL_MISSING_HINT, SecretTool } from './secret-tool.js';

describe('createSecretStore', () => {
  it('uses the Keychain on macOS', () => {
    expect(createSecretStore('darwin')).toBeInstanceOf(Keychain);
  });

  it('uses secret-tool on Linux', () => {
    expect(createSecretStore('linux')).toBeInstanceOf(SecretTool);
  });

  it('refuses any other platform with a clear error', () => {
    expect(() => createSecretStore('win32')).toThrow(/unsupported platform "win32"/);
  });
});

describe('cliRunner', () => {
  it('turns a missing binary into an INTERNAL error with the install hint', async () => {
    const runner = cliRunner('/nonexistent/paperplane-no-such-binary', 'install the thing');
    await expect(runner.run(['x'], 'stdin')).rejects.toMatchObject({ code: 'INTERNAL', message: 'install the thing' });
  });

  it('collects stdout and the exit code, passing stdin through', async () => {
    const r = await cliRunner(process.execPath, 'node missing').run(
      ['-e', 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(s, () => process.exit(3)))'],
      'hello',
    );
    expect(r).toEqual({ code: 3, stdout: 'hello', stderr: '' });
  });

  it('SecretTool surfaces the libsecret-tools install hint when secret-tool is missing', async () => {
    expect(SECRET_TOOL_MISSING_HINT).toContain('sudo apt install libsecret-tools');
    const st = new SecretTool(cliRunner('/nonexistent/secret-tool', SECRET_TOOL_MISSING_HINT));
    await expect(st.get('x')).rejects.toThrow(/libsecret-tools/);
  });
});
