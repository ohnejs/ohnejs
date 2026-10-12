import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseHexColor } from '../../../src/utils/index.ts';

describe('parseHexColor', () => {
  it('reads every hex length, in any case', () => {
    deepStrictEqual(parseHexColor('#f80'), { r: 255, g: 136, b: 0, a: 255 });
    deepStrictEqual(parseHexColor('#F808'), { r: 255, g: 136, b: 0, a: 136 });
    deepStrictEqual(parseHexColor('#Ff8800'), { r: 255, g: 136, b: 0, a: 255 });
    deepStrictEqual(parseHexColor('#ff880080'), { r: 255, g: 136, b: 0, a: 128 });
  });

  it('rejects any other form', () => {
    for (const value of ['ff8800', '#ff', '#ff880', '#ff88001', '#ggg', 'orange', '#ff8800 ', '']) {
      strictEqual(parseHexColor(value), undefined, value);
    }
  });
});
