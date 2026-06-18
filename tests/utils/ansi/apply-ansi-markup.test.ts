import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { applyANSIMarkup, pickANSIColors } from '../../../src/utils/ansi/index.ts';

const color = pickANSIColors(true);

describe('applyANSIMarkup', () => {
  it('highlights a backtick span as cyan', () => {
    strictEqual(applyANSIMarkup('use `x`', false, color), 'use \x1b[96mx\x1b[39m');
  });

  it('highlights a backtick span as bold when emphasized', () => {
    strictEqual(applyANSIMarkup('use `x`', true, color), 'use \x1b[1mx\x1b[22m');
  });

  it('bolds **x** and dims __x__', () => {
    strictEqual(applyANSIMarkup('**a** __b__', false, color), '\x1b[1ma\x1b[22m \x1b[2mb\x1b[22m');
  });

  it('leaves word-internal __ literal', () => {
    strictEqual(applyANSIMarkup('table__name', false, color), 'table__name');
  });

  it('strips markers but adds no codes when disabled', () => {
    strictEqual(applyANSIMarkup('use `x` **y**', false, pickANSIColors(false)), 'use x y');
  });
});
