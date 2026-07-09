import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { option } from '../../../src/ohne/fields/option.ts';

describe('option', () => {
  it('declares an optional option without a default', () => {
    deepStrictEqual(option(), { required: false, default: undefined });
  });

  it('keeps a declared default', () => {
    deepStrictEqual(option({ default: 255 }), { required: false, default: 255 });
  });

  it('marks a required option, its default undefined', () => {
    deepStrictEqual(option<string>({ required: true }), { required: true, default: undefined });
  });
});
