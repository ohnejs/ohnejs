import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveOhneLayers } from '../../../src/ohne/index.ts';

interface PackageSpec {
  name: string;
  ohne?: boolean;
  dependencies?: Record<string, string>;
}

describe('resolveOhneLayers', () => {
  let root: string;
  let app: string;

  function writePackage(at: string, spec: PackageSpec): void {
    mkdirSync(at, { recursive: true });
    const { ohne, ...manifest } = spec;
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
    if (ohne) writeFileSync(join(at, 'ohne.config.ts'), '');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-resolve-layers-'));
    app = join(root, 'app');
    // app -> a -> b, and app -> plain (not ohne, only traversed to reach nothing).
    writePackage(app, { name: 'app', ohne: true, dependencies: { a: '*', plain: '*' } });
    writePackage(join(app, 'node_modules', 'a'), {
      name: 'a',
      ohne: true,
      dependencies: { b: '*' },
    });
    writePackage(join(app, 'node_modules', 'b'), { name: 'b', ohne: true });
    writePackage(join(app, 'node_modules', 'plain'), { name: 'plain' });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('places a dependency before its dependent, and the app last', async () => {
    const layers = await resolveOhneLayers(app);
    deepStrictEqual(
      layers.map((layer) => layer.name),
      ['b', 'a', 'app'],
    );
    strictEqual(layers[0].dir.endsWith('/node_modules/b'), true);
    strictEqual(layers[2].dir.endsWith('/app'), true);
  });

  it('returns an empty list when no package.json is found', async () => {
    deepStrictEqual(await resolveOhneLayers(join(root, 'nowhere')), []);
  });
});
