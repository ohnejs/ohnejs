import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createImportMapResolver } from '../../../src/utils/imports/index.ts';

describe('createImportMapResolver', () => {
  const resolve = createImportMapResolver({
    'ohnejs/utils': '/m/utils/index.ts?h=1',
    'app/': '/m/app/',
    'app/pages/': '/m/pages/',
    'app/pages/home.ts': '/m/app/pages/home.ts?h=2',
    '/m/app/nav.ts': '/m/app/nav.ts?h=3',
    '/m/app/a b.ts': '/m/app/a b.ts?h=4',
  });

  it('maps a bare specifier by its exact key', () => {
    strictEqual(resolve('ohnejs/utils', '/m/app/x.ts'), '/m/utils/index.ts?h=1');
  });

  it('maps by the longest prefix key, after an exact key', () => {
    strictEqual(resolve('app/nav.ts', '/'), '/m/app/nav.ts');
    strictEqual(resolve('app/pages/list.ts', '/'), '/m/pages/list.ts');
    strictEqual(resolve('app/pages/home.ts', '/'), '/m/app/pages/home.ts?h=2');
  });

  it('resolves a path-like specifier against its importer before mapping it', () => {
    strictEqual(resolve('./nav.ts', '/m/app/x.ts?h=9'), '/m/app/nav.ts?h=3');
    strictEqual(resolve('../app/nav.ts', '/m/utils/y.ts'), '/m/app/nav.ts?h=3');
    strictEqual(resolve('/m/app/nav.ts', '/anywhere.ts'), '/m/app/nav.ts?h=3');
  });

  it('leaves an unmapped path-like specifier as its resolved path', () => {
    strictEqual(resolve('./pages/[id].ts', '/m/app/x.ts'), '/m/app/pages/[id].ts');
  });

  it('normalizes keys, specifiers and targets the way the browser parses them', () => {
    strictEqual(resolve('./a b.ts', '/m/app/x.ts'), '/m/app/a%20b.ts?h=4');
  });

  it('refuses an unmapped bare specifier or one with a scheme', () => {
    strictEqual(resolve('lodash', '/m/app/x.ts'), null);
    strictEqual(resolve('node:fs', '/m/app/x.ts'), null);
    strictEqual(resolve('https://cdn.example/x.js', '/m/app/x.ts'), null);
  });
});
