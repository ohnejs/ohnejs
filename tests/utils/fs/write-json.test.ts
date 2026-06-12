import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { writeJSON } from '../../../src/utils/fs/index.ts';

describe('writeJSON', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-write-json-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes pretty-printed JSON by default', async () => {
    const f = join(dir, 'config.json');
    await writeJSON(f, { port: 3000 });
    strictEqual(readFileSync(f, 'utf8'), '{\n  "port": 3000\n}');
  });

  it('round-trips through JSON.parse', async () => {
    const f = join(dir, 'data.json');
    const value = { a: 1, b: [2, 3], c: { d: 'x' } };
    await writeJSON(f, value);
    deepStrictEqual(JSON.parse(readFileSync(f, 'utf8')) as unknown, value);
  });

  it('honors a custom indent', async () => {
    const f = join(dir, 'compact.json');
    await writeJSON(f, { a: 1 }, { indent: 0 });
    strictEqual(readFileSync(f, 'utf8'), '{"a":1}');
  });

  it('creates missing parent directories', async () => {
    const f = join(dir, 'nested', 'config.json');
    await writeJSON(f, { x: 1 });
    deepStrictEqual(JSON.parse(readFileSync(f, 'utf8')) as unknown, { x: 1 });
  });
});
