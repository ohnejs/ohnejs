import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  parseLayerSpecifier,
  resolveLayerDir,
  resolveLayerSubpath,
} from '../../../src/ohne/index.ts';

describe('parseLayerSpecifier', () => {
  it('splits a scoped name from its subpath', () => {
    deepStrictEqual(parseLayerSpecifier('@acme/kit/auth'), {
      name: '@acme/kit',
      subpath: './auth',
    });
  });

  it('splits a plain name from a nested subpath', () => {
    deepStrictEqual(parseLayerSpecifier('ohnejs/layers/uploads'), {
      name: 'ohnejs',
      subpath: './layers/uploads',
    });
  });

  it('yields the root subpath for a bare name', () => {
    deepStrictEqual(parseLayerSpecifier('@acme/base'), { name: '@acme/base', subpath: '.' });
    deepStrictEqual(parseLayerSpecifier('ohnejs'), { name: 'ohnejs', subpath: '.' });
  });
});

describe('resolveLayerDir', { skip: process.platform === 'win32' }, () => {
  let root: string;
  let app: string;
  let kit: string;

  function writePackage(name: string, exports: unknown): string {
    const dir = join(app, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports }));
    return realpathSync(dir);
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-resolve-layer-dir-'));
    app = join(root, 'app');
    mkdirSync(app, { recursive: true });

    kit = writePackage('@acme/kit', { './auth': './auth/ohne.config.ts' });
    writePackage('@acme/wild', { './*': './*/ohne.config.ts' });
    writePackage('@acme/conditional', {
      './auth': { types: './auth/ohne.config.ts', default: './auth/ohne.config.ts' },
    });
    writePackage('@acme/nested', { './*': { node: { import: './*/ohne.config.ts' } } });
    writePackage('@acme/typed', { './auth': { types: './auth/ohne.config.ts' } });
    writePackage('@acme/overlap', {
      './*/ohne': './x/*/ohne.config.ts',
      './a/*': './a/*/ohne.config.ts',
    });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a bare package name to its root', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit', app), kit);
  });

  it('resolves an exact exports subpath to its config directory', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit/auth', app), join(kit, 'auth'));
  });

  it('resolves a subpath through an exports wildcard', async () => {
    const wild = realpathSync(join(app, 'node_modules/@acme/wild'));
    deepStrictEqual(await resolveLayerDir('@acme/wild/blog', app), join(wild, 'blog'));
  });

  it('unwraps a conditional exports target', async () => {
    const conditional = realpathSync(join(app, 'node_modules/@acme/conditional'));
    deepStrictEqual(
      await resolveLayerDir('@acme/conditional/auth', app),
      join(conditional, 'auth'),
    );
  });

  it('unwraps nested conditions behind an exports wildcard', async () => {
    const nested = realpathSync(join(app, 'node_modules/@acme/nested'));
    deepStrictEqual(await resolveLayerDir('@acme/nested/blog', app), join(nested, 'blog'));
  });

  it('prefers the wildcard with the longer prefix, as Node does', async () => {
    const overlap = realpathSync(join(app, 'node_modules/@acme/overlap'));
    deepStrictEqual(await resolveLayerDir('@acme/overlap/a/ohne', app), join(overlap, 'a/ohne'));
  });

  it('returns null when the package is not installed', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/missing', app), null);
  });

  it('returns null when the subpath is not exported', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit/ghost', app), null);
  });

  it('returns null when the only condition is types', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/typed/auth', app), null);
  });
});

describe('resolveLayerSubpath', { skip: process.platform === 'win32' }, () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-resolve-layer-subpath-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'app',
        exports: { './uploads': { default: './uploads/ohne.config.ts' } },
      }),
    );
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the root subpath to the root itself', async () => {
    deepStrictEqual(await resolveLayerSubpath(root, '.'), root);
  });

  it('resolves an exported subpath to its config directory', async () => {
    deepStrictEqual(await resolveLayerSubpath(root, './uploads'), join(root, 'uploads'));
  });

  it('returns null when the subpath is not exported', async () => {
    deepStrictEqual(await resolveLayerSubpath(root, './ghost'), null);
  });
});
