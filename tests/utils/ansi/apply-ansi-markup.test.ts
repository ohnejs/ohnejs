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

  it('leaves markers inside a quoted path', () => {
    const raw = "unlink '/x/__init__.py' and '/y/x**2**.txt'";
    strictEqual(applyANSIMarkup(raw, false, color), raw);
  });

  it('leaves a marker pair with a space just inside literal', () => {
    strictEqual(applyANSIMarkup('3 ** 2 + 4 ** 2', false, color), '3 ** 2 + 4 ** 2');
  });

  it('closes a span only at a backtick run of its own length', () => {
    strictEqual(applyANSIMarkup('``a`b``', false, color), '\x1b[96ma`b\x1b[39m');
    strictEqual(applyANSIMarkup('``a`', false, color), '``a`');
  });

  it('closes a span across a carriage return or a line separator', () => {
    strictEqual(applyANSIMarkup('`a\rb`', false, color), '\x1b[96ma\rb\x1b[39m');
    strictEqual(applyANSIMarkup('`a b`', false, color), '\x1b[96ma b\x1b[39m');
  });

  it('drops one padding space on each side of a span, never from a blank one', () => {
    strictEqual(applyANSIMarkup('`` `x ``', false, color), '\x1b[96m`x\x1b[39m');
    strictEqual(applyANSIMarkup('`  `', false, color), '\x1b[96m  \x1b[39m');
  });

  it('styles nothing inside a backtick span', () => {
    strictEqual(applyANSIMarkup('`__init__.py`', false, color), '\x1b[96m__init__.py\x1b[39m');
  });

  it('renders a backtick span nested in bold or dim', () => {
    strictEqual(
      applyANSIMarkup('**a `b` c**', false, color),
      '\x1b[1ma \x1b[96mb\x1b[39m c\x1b[22m',
    );
    strictEqual(
      applyANSIMarkup('__in `3ms`__', false, color),
      '\x1b[2min \x1b[96m3ms\x1b[39m\x1b[22m',
    );
  });

  it('strips markers but adds no codes when disabled', () => {
    strictEqual(applyANSIMarkup('use `x` **y**', false, pickANSIColors(false)), 'use x y');
  });
});
