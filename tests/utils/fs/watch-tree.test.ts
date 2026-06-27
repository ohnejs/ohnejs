import { ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { watchTree } from '../../../src/utils/fs/index.ts';

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(15);
  }
}

describe('watchTree', () => {
  let dir: string;
  let stop: (() => void) | undefined;
  let changed: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-watch-tree-'));
    changed = [];
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a change to a file in the root', async () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'one');
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    writeFileSync(file, 'two');
    await waitFor(() => changed.some((path) => path.endsWith('/a.ts')));
  });

  it('watches a pre-existing nested directory', async () => {
    mkdirSync(join(dir, 'nested'));
    const file = join(dir, 'nested', 'b.ts');
    writeFileSync(file, 'one');
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    writeFileSync(file, 'two');
    await waitFor(() => changed.some((path) => path.endsWith('/nested/b.ts')));
  });

  it('picks up a directory created after watching starts', async () => {
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    mkdirSync(join(dir, 'late'));
    const file = join(dir, 'late', 'c.ts');
    writeFileSync(file, 'one');
    await waitFor(() => changed.some((path) => path.includes('/late')));

    await delay(50);
    changed.length = 0;
    writeFileSync(file, 'two');
    await waitFor(() => changed.some((path) => path.endsWith('/late/c.ts')));
  });

  it('reports a file created together with its new directory', async () => {
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    mkdirSync(join(dir, 'fresh'));
    writeFileSync(join(dir, 'fresh', 'g.ts'), 'one');

    await waitFor(() => changed.some((path) => path.endsWith('/fresh/g.ts')));
  });

  it('ignores node_modules', async () => {
    mkdirSync(join(dir, 'node_modules'));
    const file = join(dir, 'node_modules', 'd.ts');
    writeFileSync(file, 'one');
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    writeFileSync(file, 'two');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/d.ts')));
  });

  it('honors a custom ignore list', async () => {
    mkdirSync(join(dir, 'dist'));
    const file = join(dir, 'dist', 'e.ts');
    writeFileSync(file, 'one');
    stop = watchTree(dir, (path) => changed.push(path), { ignore: ['dist'] });
    await delay(50);

    writeFileSync(file, 'two');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/e.ts')));
  });

  it('stops reporting after the closer runs', async () => {
    const file = join(dir, 'f.ts');
    writeFileSync(file, 'one');
    stop = watchTree(dir, (path) => changed.push(path));
    await delay(50);

    stop();
    stop = undefined;
    changed.length = 0;
    writeFileSync(file, 'two');
    await delay(150);
    strictEqual(changed.length, 0);
  });
});
