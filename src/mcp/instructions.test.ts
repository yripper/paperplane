import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_INSTRUCTIONS, buildInstructions, readStyleGuide } from './instructions.js';

describe('buildInstructions', () => {
  it('is the base text alone without a style guide', () => {
    expect(buildInstructions(null)).toBe(BASE_INSTRUCTIONS);
  });

  it('appends the style guide under its own heading', () => {
    const text = buildInstructions('Short, lowercase, no sign-offs.');
    expect(text.startsWith(BASE_INSTRUCTIONS)).toBe(true);
    expect(text.endsWith('## Writing style\n\nShort, lowercase, no sign-offs.')).toBe(true);
  });

  it('keeps the approval rule for sends', () => {
    expect(BASE_INSTRUCTIONS).toContain('wait for the user\'s explicit OK');
  });
});

describe('readStyleGuide', () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), 'pp-style-'));

  it('returns the trimmed file contents', () => {
    const path = join(dir(), 'style.md');
    writeFileSync(path, '\n  casual, short  \n\n');
    expect(readStyleGuide(path)).toBe('casual, short');
  });

  it('returns null when the file is missing', () => {
    expect(readStyleGuide(join(dir(), 'style.md'))).toBeNull();
  });

  it('returns null when the file is blank', () => {
    const path = join(dir(), 'style.md');
    writeFileSync(path, '  \n');
    expect(readStyleGuide(path)).toBeNull();
  });
});
