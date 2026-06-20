import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveDependencyLayerNames } from '../../../src/ohne/index.ts';

interface PackageSpec {
  name: string;
  ohne?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

describe('resolveDependencyLayerNames', () => {
  let dir: string;
  let app: string;

  function writePackage(at: string, spec: PackageSpec): void {
    mkdirSync(at, { recursive: true });
    const { ohne, ...manifest } = spec;
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
    if (ohne) writeFileSync(join(at, 'ohne.config.ts'), '');
  }

  function writeDep(spec: PackageSpec): void {
    writePackage(join(app, 'node_modules', spec.name), spec);
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-resolve-apps-'));
    app = join(dir, 'app');

    // Root is an ohne app and must be excluded from its own closure.
    writePackage(app, {
      name: 'app',
      ohne: true,
      dependencies: { a: '*', plain: '*' },
      devDependencies: { d: '*' },
      peerDependencies: { p: '*' },
      optionalDependencies: { opt: '*' },
    });

    // a: ohne, pulls b transitively, and a dev dep that must NOT be followed.
    writeDep({ name: 'a', ohne: true, dependencies: { b: '*' }, devDependencies: { devOfA: '*' } });
    // plain: not ohne, but its non-dev dep c must still be reached and counted.
    writeDep({ name: 'plain', dependencies: { c: '*' } });
    // b: ohne, and depends back on a to exercise cycle handling.
    writeDep({ name: 'b', ohne: true, dependencies: { a: '*' } });
    writeDep({ name: 'c', ohne: true });
    writeDep({ name: 'd', ohne: true });
    writeDep({ name: 'p', ohne: true });
    writeDep({ name: 'opt', ohne: true });
    // devOfA is an ohne app, reachable only through a's devDependencies -> excluded.
    writeDep({ name: 'devOfA', ohne: true });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('collects every ohne layer across all dependency kinds, in registration order', async () => {
    deepStrictEqual(await resolveDependencyLayerNames(app), ['b', 'a', 'c', 'p', 'opt', 'd']);
  });

  it('does not follow transitive dev dependencies', async () => {
    const names = await resolveDependencyLayerNames(app);
    deepStrictEqual(names.includes('devOfA'), false);
  });

  it('returns [] when no package.json is found', async () => {
    deepStrictEqual(await resolveDependencyLayerNames(join(dir, 'nowhere')), []);
  });
});
