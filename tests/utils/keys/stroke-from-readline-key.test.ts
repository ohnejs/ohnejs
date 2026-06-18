import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { strokeFromReadlineKey } from '../../../src/utils/index.ts';

describe('strokeFromReadlineKey', () => {
  it('translates a named key to its KeyboardEvent.key spelling', () => {
    deepStrictEqual(strokeFromReadlineKey(undefined, { name: 'left' }), {
      key: 'ArrowLeft',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
  });

  it('maps readline meta to alt and never reports meta', () => {
    deepStrictEqual(strokeFromReadlineKey(undefined, { name: 'backspace', meta: true }), {
      key: 'Backspace',
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    });
  });

  it('keeps the printable string over the name when they differ', () => {
    deepStrictEqual(strokeFromReadlineKey('A', { name: 'a', shift: true }), {
      key: 'A',
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('falls back to the name when the string is a control character', () => {
    deepStrictEqual(strokeFromReadlineKey('\x01', { name: 'a', ctrl: true }), {
      key: 'a',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    });
  });
});
