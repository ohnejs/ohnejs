import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readJSON } from '../../../src/utils/fs/index.ts';

describe('readJSON', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-read-json-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads and parses a JSON file', async () => {
    const f = join(dir, 'config.json');
    writeFileSync(f, '{"port": 3000}');
    deepStrictEqual(await readJSON(f), { port: 3000 });
  });

  it('returns null when the file is missing', async () => {
    strictEqual(await readJSON(join(dir, 'missing.json')), null);
  });

  it('throws on malformed JSON', async () => {
    const f = join(dir, 'bad.json');
    writeFileSync(f, '{ not json');
    await rejects(readJSON(f), SyntaxError);
  });
});
