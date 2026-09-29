import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isMessage } from '../../../src/utils/index.ts';

describe('isMessage', () => {
  it('accepts a string, key or plain text alike', () => {
    strictEqual(isMessage('dashboard.yes'), true);
    strictEqual(isMessage('Yes'), true);
    strictEqual(isMessage(''), true);
  });

  it('accepts an object with a string key, with or without params', () => {
    strictEqual(isMessage({ key: 'field.min', params: { n: 2 } }), true);
    strictEqual(isMessage({ key: 'field.required' }), true);
  });

  it('rejects an object without a string key', () => {
    strictEqual(isMessage({ params: {} }), false);
    strictEqual(isMessage({ key: 1 }), false);
    strictEqual(isMessage(new Map([['key', 'x']])), false);
  });

  it('rejects other values', () => {
    strictEqual(isMessage(42), false);
    strictEqual(isMessage(null), false);
    strictEqual(isMessage(undefined), false);
    strictEqual(isMessage(['key']), false);
  });
});
