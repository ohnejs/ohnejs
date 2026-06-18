import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { strokeFromKeyboardEvent } from '../../../src/utils/index.ts';

describe('strokeFromKeyboardEvent', () => {
  it('renames the modifier fields', () => {
    deepStrictEqual(
      strokeFromKeyboardEvent({
        key: 'z',
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        metaKey: true,
      }),
      {
        key: 'z',
        ctrl: false,
        alt: false,
        shift: true,
        meta: true,
      },
    );
  });
});
