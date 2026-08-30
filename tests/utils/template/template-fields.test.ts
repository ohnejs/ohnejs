import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { templateFields } from '../../../src/utils/index.ts';

describe('templateFields', () => {
  it('lists token names in order', () => {
    deepStrictEqual(templateFields('{lastName}, {firstName}'), ['lastName', 'firstName']);
  });

  it('keeps repeats', () => {
    deepStrictEqual(templateFields('{a} vs {a}'), ['a', 'a']);
  });

  it('returns an empty list for a template without tokens', () => {
    deepStrictEqual(templateFields('plain'), []);
  });

  it('returns undefined for a malformed template', () => {
    strictEqual(templateFields('{oops'), undefined);
    strictEqual(templateFields('a}b'), undefined);
  });
});
