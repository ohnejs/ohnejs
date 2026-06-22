import { strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { serveAPI, useEnv } from '../../../src/ohne/index.ts';

const scope = globalThis as typeof globalThis & { __ohneServeBoot: string[] };

describe('serveAPI', () => {
  let root: string;

  function makeApp(name: string, mark: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    mkdirSync(join(dir, 'boot'));
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      `globalThis.__ohneServeBoot.push(${JSON.stringify(mark)})\n`,
    );
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-api-'));
    scope.__ohneServeBoot = [];
  });

  after(() => {
    useEnv().unset('SKIP_CODEGEN');
    rmSync(root, { recursive: true, force: true });
  });

  it('boots the layers, then generates the codegen files', async () => {
    const dir = makeApp('app', 'app:boot');

    await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('app:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne', 'layer-name.ts')), true);
    strictEqual(existsSync(join(dir, '.ohne', 'resolved-config.ts')), true);
  });

  it('boots but skips codegen when `SKIP_CODEGEN` is set', async () => {
    const dir = makeApp('skip', 'skip:boot');
    useEnv().set('SKIP_CODEGEN', true);

    await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('skip:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne')), false);
  });
});
