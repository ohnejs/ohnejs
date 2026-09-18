import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  LOGO_GLYPHS,
  LOGO_WELL_X,
  LOGO_WELL_Y,
  logoFrame,
} from '../../../../src/base/dashboard/components/logo-model.ts';

const STARTS = [66, 128, 194];

/**
 * Asserts two floats agree beyond rounding noise.
 */
function near(actual: number, expected: number): void {
  ok(Math.abs(actual - expected) < 1e-9, `${actual} is not near ${expected}`);
}

describe('logoFrame', () => {
  it('rests as the full wordmark at fold `0`', () => {
    const frame = logoFrame(0);
    strictEqual(frame.width, 234);
    strictEqual(frame.ring, 20);
    strictEqual(frame.stroke, 8);
    strictEqual(frame.hole, 16);
    strictEqual(frame.glyphs.length, LOGO_GLYPHS.length);
    for (const glyph of frame.glyphs) {
      strictEqual(glyph.scale, 1);
      near(glyph.x, 0);
      near(glyph.y, 0);
    }
  });

  it('closes into the solid dot at fold `1`', () => {
    const frame = logoFrame(1);
    strictEqual(frame.width, 48);
    strictEqual(frame.ring, 12);
    strictEqual(frame.stroke, 24);
    strictEqual(frame.hole, 0);
    frame.glyphs.forEach((glyph, i) => {
      near(glyph.scale, 0.05);
      near(glyph.scale * STARTS[i] + glyph.x, LOGO_WELL_X);
      near(glyph.scale * LOGO_WELL_Y + glyph.y, LOGO_WELL_Y);
    });
  });

  it('pins the outer edge of the `o` at `24` throughout', () => {
    for (const fold of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const { ring, stroke } = logoFrame(fold);
      near(ring + stroke / 2, 24);
    }
  });

  it('narrows and closes monotonically as it folds', () => {
    let previous = logoFrame(0);
    for (let fold = 0.05; fold <= 1; fold += 0.05) {
      const frame = logoFrame(fold);
      ok(frame.width <= previous.width, `width grew at ${fold}`);
      ok(frame.hole <= previous.hole, `hole grew at ${fold}`);
      previous = frame;
    }
  });

  it('folds the letter nearest the well first', () => {
    const { glyphs } = logoFrame(0.4);
    ok(glyphs[0].scale < glyphs[1].scale);
    ok(glyphs[1].scale < glyphs[2].scale);
    strictEqual(glyphs[2].scale, 1);
  });

  it('never lets the word outgrow its rest width', () => {
    for (let fold = 0; fold <= 1; fold += 0.01) {
      const { width } = logoFrame(fold);
      ok(width <= 234 && width >= 48, `width ${width} out of range at ${fold}`);
    }
  });
});
