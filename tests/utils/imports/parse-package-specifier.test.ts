import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parsePackageSpecifier } from '../../../src/utils/imports/index.ts';

describe('parsePackageSpecifier', () => {
  it('splits a scoped name from its subpath', () => {
    deepStrictEqual(parsePackageSpecifier('@acme/kit/auth'), {
      name: '@acme/kit',
      subpath: './auth',
    });
  });

  it('splits a plain name from a nested subpath', () => {
    deepStrictEqual(parsePackageSpecifier('ohnejs/layers/uploads'), {
      name: 'ohnejs',
      subpath: './layers/uploads',
    });
  });

  it('yields the root subpath for a bare name', () => {
    deepStrictEqual(parsePackageSpecifier('@acme/base'), { name: '@acme/base', subpath: '.' });
    deepStrictEqual(parsePackageSpecifier('ohnejs'), { name: 'ohnejs', subpath: '.' });
  });
});
