import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatHexColor, parseHexColor } from '../../../src/utils/index.ts';

describe('formatHexColor', () => {
  it('writes an opaque color as lowercase `#rrggbb`', () => {
    strictEqual(formatHexColor({ r: 255, g: 136, b: 0, a: 255 }), '#ff8800');
    strictEqual(formatHexColor({ r: 0, g: 10, b: 1, a: 255 }), '#000a01');
  });

  it('keeps the alpha channel only when it is below opaque', () => {
    strictEqual(formatHexColor({ r: 255, g: 136, b: 0, a: 128 }), '#ff880080');
    strictEqual(formatHexColor({ r: 255, g: 136, b: 0, a: 0 }), '#ff880000');
  });

  it('gives every spelling of one color the same form', () => {
    const forms = ['#F80', '#ff8800', '#FF8800FF', '#f80f'].map((value) =>
      formatHexColor(parseHexColor(value)!),
    );
    strictEqual(new Set(forms).size, 1);
  });
});
