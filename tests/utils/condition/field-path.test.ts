import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseFieldPath } from '../../../src/utils/condition/field-path.ts';

describe('parseFieldPath', () => {
  it('splits dot parts', () => {
    deepStrictEqual(parseFieldPath('title'), ['title']);
    deepStrictEqual(parseFieldPath('seo.title'), ['seo', 'title']);
  });

  it('turns each leading `../` into a climb', () => {
    deepStrictEqual(parseFieldPath('../../kind'), ['..', '..', 'kind']);
  });

  it('reads a leading `/` as the root', () => {
    deepStrictEqual(parseFieldPath('/kind'), ['/', 'kind']);
    deepStrictEqual(parseFieldPath('/../kind'), ['/', '..', 'kind']);
  });

  it('rejects an empty part', () => {
    strictEqual(parseFieldPath(''), undefined);
    strictEqual(parseFieldPath('/'), undefined);
    strictEqual(parseFieldPath('../'), undefined);
    strictEqual(parseFieldPath('seo..title'), undefined);
    strictEqual(parseFieldPath('seo.'), undefined);
  });

  it('rejects a `..` that is not a leading climb', () => {
    strictEqual(parseFieldPath('seo/../title'), undefined);
    strictEqual(parseFieldPath('..'), undefined);
  });
});
