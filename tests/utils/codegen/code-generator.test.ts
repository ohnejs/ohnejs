import { deepStrictEqual, strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createCodeGenerator } from '../../../src/utils/codegen/index.ts';

describe('createCodeGenerator', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-generator-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a file and reports the change', async () => {
    const gen = createCodeGenerator({ dir: join(root, 'write') });
    strictEqual(await gen.write('imports.ts', 'export const x = 1\n'), true);
    strictEqual(readFileSync(gen.path('imports.ts'), 'utf8'), 'export const x = 1\n');
  });

  it('skips an unchanged file on a second run', async () => {
    const dir = join(root, 'unchanged');
    const first = createCodeGenerator({ dir });
    await first.write('a.ts', 'same\n');
    const mtime = statSync(first.path('a.ts')).mtimeMs;

    const second = createCodeGenerator({ dir });
    strictEqual(await second.write('a.ts', 'same\n'), false);
    strictEqual(statSync(second.path('a.ts')).mtimeMs, mtime);
  });

  it('prepends the banner to written files', async () => {
    const gen = createCodeGenerator({ dir: join(root, 'banner'), banner: '// generated' });
    await gen.write('a.ts', 'body\n');
    strictEqual(readFileSync(gen.path('a.ts'), 'utf8'), '// generated\nbody\n');
  });

  it('tracks written paths in order', async () => {
    const gen = createCodeGenerator({ dir: join(root, 'tracked') });
    await gen.write('a.ts', '1');
    await gen.write('nested/b.ts', '2');
    deepStrictEqual(gen.written(), ['a.ts', 'nested/b.ts']);
  });

  it('prunes files it did not write', async () => {
    const dir = join(root, 'prune');
    const first = createCodeGenerator({ dir });
    await first.write('keep.ts', '1');
    await first.write('drop.ts', '2');

    const second = createCodeGenerator({ dir });
    await second.write('keep.ts', '1');
    const removed = await second.prune();

    deepStrictEqual(removed, ['drop.ts']);
    strictEqual(existsSync(second.path('keep.ts')), true);
    strictEqual(existsSync(second.path('drop.ts')), false);
  });

  it('prunes a file left behind by something else', async () => {
    const dir = join(root, 'prune-foreign');
    const gen = createCodeGenerator({ dir });
    await gen.write('mine.ts', '1');
    writeFileSync(join(dir, 'stale.ts'), 'old');

    deepStrictEqual(await gen.prune(), ['stale.ts']);
  });

  it('leaves a hidden file in place', async () => {
    const dir = join(root, 'prune-hidden');
    const gen = createCodeGenerator({ dir });
    await gen.write('mine.ts', '1');
    writeFileSync(join(dir, '.keep'), '');
    writeFileSync(join(dir, 'stale.ts'), 'old');

    deepStrictEqual(await gen.prune(), ['stale.ts']);
    strictEqual(existsSync(join(dir, '.keep')), true);
  });

  it('prunes nothing when the directory does not exist', async () => {
    const gen = createCodeGenerator({ dir: join(root, 'absent') });
    deepStrictEqual(await gen.prune(), []);
  });
});
