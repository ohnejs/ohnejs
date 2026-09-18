import { clamp, smoothstep } from 'ohnejs/utils';

/**
 * One letter's placement for a frame: the parts of a uniform-scale SVG `matrix` transform.
 */
export interface LogoGlyph {
  /**
   * The uniform scale: `1` at rest, `0.05` once folded into the well.
   */
  scale: number;

  /**
   * The horizontal offset in grid units, applied after scaling about the origin.
   */
  x: number;

  /**
   * The vertical offset in grid units, applied after scaling about the origin.
   */
  y: number;
}

/**
 * One frame of the mark.
 */
export interface LogoFrame {
  /**
   * The viewBox width: `234` for the word, `48` for the dot alone.
   */
  width: number;

  /**
   * The `o` ring's centreline radius: `20` at rest, `12` when solid.
   */
  ring: number;

  /**
   * The `o` ring's stroke width: `8` at rest, `24` when solid, so the outer edge stays at `24`.
   */
  stroke: number;

  /**
   * The counter's radius, `16` down to `0`.
   * It also cuts the mask that hides whatever has folded inside the well.
   */
  hole: number;

  /**
   * The `h`, `n`, and `e`, in order.
   */
  glyphs: LogoGlyph[];
}

/**
 * The height of the mark's grid, the SVG viewBox.
 * The ascender tops out at `12`, the x-height at `32`, and the baseline sits at `80`.
 */
export const LOGO_HEIGHT = 92;

/**
 * The horizontal centre of the well: the `o`, where the other letters fold in.
 */
export const LOGO_WELL_X = 24;

/**
 * The vertical centre of the well, on the x-height centreline.
 */
export const LOGO_WELL_Y = 56;

/**
 * The `h`, `n`, and `e` as path data on the mark's grid.
 * Every bowl and shoulder is a `20` radius on the stroke's centreline, the same as the `o`.
 * Each letter sits in a `48`-wide box on a `62` advance.
 */
export const LOGO_GLYPHS: readonly string[] = [
  'M66 56L66 12M66 56L66 80M66 56A20 20 0 0 1 106 56L106 80',
  'M128 80L128 56A20 20 0 0 1 168 56L168 80',
  'M194 56L233.66 56M215.18 75.32A20 20 0 1 1 230 56',
];

const STARTS = [66, 128, 194];
const ADVANCE = 62;
const BOX = 48;
const WINDOW = 0.46;
const STEP = 0.27;

/**
 * Lays the mark out for one frame.
 * `fold` runs from `0`, the full `ohne` wordmark, to `1`, the solid dot.
 * The letters fold into the well in three overlapping windows, the nearest leading.
 * Each accelerates inward while shrinking to its own left edge.
 * Its slot closes by the width it sheds and the ground it covers, so no gap opens inside the word.
 * The `o` closes its counter as mass arrives, its outer edge pinned at `24` throughout.
 */
export function logoFrame(fold: number): LogoFrame {
  let shift = 0;
  let width = BOX;
  let absorbed = 0;
  const glyphs = STARTS.map((start, i) => {
    const k = smoothstep((fold - i * STEP) / WINDOW);
    absorbed += k / STARTS.length;
    const pull = Math.pow(k, 1.9);
    const scale = 1 - 0.95 * Math.pow(k, 1.15);
    const x = shift + (LOGO_WELL_X - start - shift) * pull;
    const y = -Math.sin(Math.PI * k) * 4.5;
    const close = clamp((BOX * (1 - scale) + (start + shift - LOGO_WELL_X) * pull) / ADVANCE, 0, 1);
    shift -= ADVANCE * close;
    width += ADVANCE * (1 - close);
    return { scale, x: x + start * (1 - scale), y: y + LOGO_WELL_Y * (1 - scale) };
  });
  const closed = Math.pow(absorbed, 1.6);
  return {
    width,
    ring: 20 - 8 * closed,
    stroke: 8 + 16 * closed,
    hole: 16 * (1 - closed),
    glyphs,
  };
}
