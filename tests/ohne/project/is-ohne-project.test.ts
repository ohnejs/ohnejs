import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { isOhneProject } from '../../../src/ohne/index.ts';

describe('isOhneProject', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-is-project-'));
    mkdirSync(join(dir, 'app'));
    mkdirSync(join(dir, 'plain'));
    writeFileSync(join(dir, 'app', 'ohne.config.ts'), '');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns true when ohne.config.ts is present', async () => {
    strictEqual(await isOhneProject(join(dir, 'app')), true);
  });

  it('returns false when it is absent', async () => {
    strictEqual(await isOhneProject(join(dir, 'plain')), false);
  });
});
