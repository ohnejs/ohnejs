import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveDependencyLayerNames } from '../../../src/ohne/index.ts';

interface PackageSpec {
  name: string;
  ohne?: boolean;
  subLayers?: string[];
  exports?: Record<string, unknown>;
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
    const { ohne, subLayers, ...manifest } = spec;
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
    if (ohne) writeFileSync(join(at, 'ohne.config.ts'), '');
    for (const sub of subLayers ?? []) {
      mkdirSync(join(at, sub), { recursive: true });
      writeFileSync(join(at, sub, 'ohne.config.ts'), '');
    }
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
      subLayers: ['extra'],
      exports: { '.': './index.ts', './extra': './extra/ohne.config.ts' },
      dependencies: { a: '*', plain: '*', kit: '*', 'only-sub': '*' },
      devDependencies: { d: '*' },
      peerDependencies: { p: '*' },
      optionalDependencies: { opt: '*' },
    });

    // only-sub: not a layer at its root, but it exports one.
    writeDep({
      name: 'only-sub',
      subLayers: ['blog'],
      exports: { './blog': './blog/ohne.config.ts' },
    });

    // kit: ohne, and exports two subfolders, of which only auth is a layer; the pattern is ignored.
    writeDep({
      name: 'kit',
      ohne: true,
      subLayers: ['auth'],
      exports: {
        '.': { types: './index.ts', default: './index.ts' },
        './auth': { types: './auth/index.ts', default: './auth/index.ts' },
        './types': './types/index.ts',
        './config': './ohne.config.ts',
        './*': './*',
      },
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
    deepStrictEqual(await resolveDependencyLayerNames(app), [
      'b',
      'a',
      'c',
      'kit',
      'kit/auth',
      'only-sub/blog',
      'p',
      'opt',
      'd',
      'app/extra',
    ]);
  });

  it('lists a subpath layer only for an exported directory holding an ohne.config.ts', async () => {
    const names = await resolveDependencyLayerNames(app);
    deepStrictEqual(names.includes('kit/types'), false);
    deepStrictEqual(names.includes('kit/config'), false);
    deepStrictEqual(
      names.some((name) => name.includes('*')),
      false,
    );
  });

  it('does not follow transitive dev dependencies', async () => {
    const names = await resolveDependencyLayerNames(app);
    deepStrictEqual(names.includes('devOfA'), false);
  });

  it('returns [] when no package.json is found', async () => {
    deepStrictEqual(await resolveDependencyLayerNames(join(dir, 'nowhere')), []);
  });
});
