import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkColor } from '../../../src/utils/index.ts';

describe('checkColor', () => {
  it('accepts an opaque hex color either way', () => {
    strictEqual(checkColor('#FF8800', { alpha: false }), undefined);
    strictEqual(checkColor('#f80f', { alpha: false }), undefined);
    strictEqual(checkColor('#f80', { alpha: true }), undefined);
  });

  it('accepts a translucent color only with `alpha`', () => {
    strictEqual(checkColor('#ff880080', { alpha: true }), undefined);
    strictEqual(checkColor('#ff880080', { alpha: false }), 'validation.invalidColor');
  });

  it('names the form the field takes', () => {
    strictEqual(checkColor('orange', { alpha: false }), 'validation.invalidColor');
    strictEqual(checkColor('orange', { alpha: true }), 'validation.invalidColorAlpha');
  });
});
