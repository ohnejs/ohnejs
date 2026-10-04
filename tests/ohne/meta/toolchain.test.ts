import { deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import pkg from '../../../package.json' with { type: 'json' };
import { toolchain } from '../../../src/ohne/meta/toolchain.ts';
import { version } from '../../../src/ohne/meta/version.ts';
import { listDir } from '../../../src/utils/fs/index.ts';
import { codeFences } from '../../../src/utils/index.ts';

const DOCS = join(import.meta.dirname, '../../../docs');

/**
 * Every starter `package.json` the docs show, as `[page, manifest]`.
 */
async function starters(): Promise<[string, any][]> {
  const found: [string, any][] = [];
  for (const entry of (await listDir(DOCS, { ext: 'md' })) ?? []) {
    for (const fence of codeFences(readFileSync(entry.path, 'utf8'))) {
      if (!fence.info.startsWith('json') || !fence.body.includes('"ohnejs"')) continue;
      const manifest = JSON.parse(fence.body);
      if (typeof manifest.dependencies?.ohnejs === 'string')
        found.push([entry.relativePath, manifest]);
    }
  }
  return found;
}

describe('toolchain', () => {
  it('mirrors the pins in package.json', () => {
    deepStrictEqual(toolchain.devDependencies, {
      '@types/node': pkg.devDependencies['@types/node'],
      typescript: pkg.devDependencies.typescript,
    });
    deepStrictEqual(toolchain.engines, pkg.engines);
  });

  it('matches every starter `package.json` in the docs, so run `pnpm sync:starter` after a bump', async () => {
    const found = await starters();
    ok(found.length > 0);
    for (const [page, manifest] of found) {
      deepStrictEqual(
        {
          ohnejs: manifest.dependencies.ohnejs,
          devDependencies: manifest.devDependencies,
          engines: manifest.engines,
        },
        { ohnejs: version, ...toolchain },
        page,
      );
    }
  });
});
