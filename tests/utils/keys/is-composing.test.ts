import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isComposing } from '../../../src/utils/index.ts';

describe('isComposing', () => {
  it('reads a key inside a composition as composing', () => {
    strictEqual(isComposing({ isComposing: true, keyCode: 13 }), true);
  });

  it('reads the key code an input method takes as composing, as Safari fires it', () => {
    strictEqual(isComposing({ isComposing: false, keyCode: 229 }), true);
  });

  it('leaves a plain key alone', () => {
    strictEqual(isComposing({ isComposing: false, keyCode: 13 }), false);
  });
});
