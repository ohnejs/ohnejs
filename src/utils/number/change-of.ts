/**
 * Which way a number moved against an earlier one, and whether that is good news.
 */
export interface Change {
  /**
   * The relative change, `0.23` for 23% up, or `null` when there was nothing before to compare with.
   * For a change in `points` it is the difference of the two rates instead, `0.03` for 3 points up.
   */
  ratio: number | null;

  /**
   * Whether `ratio` is a difference in percentage points, as a change of a rate reads best.
   *
   * @default
   * false
   */
  points?: boolean;

  /**
   * The direction, `flat` within half a percent or half a point.
   */
  direction: 'up' | 'down' | 'flat';

  /**
   * Whether the change is welcome, unwelcome, or neither.
   */
  tone: 'good' | 'bad' | 'neutral';
}

const FLAT = 0.005;

/**
 * The change from `previous` to `current`; `inverted` marks a number where lower is better.
 * Growth from zero has no ratio and no tone, since a zero before says nothing of how good it is.
 *
 * @example
 * ```ts
 * changeOf(123, 100)      // -> { ratio: 0.23, direction: 'up', tone: 'good' }
 * changeOf(80, 100)       // -> { ratio: -0.2, direction: 'down', tone: 'bad' }
 * changeOf(80, 100, true) // -> { ratio: -0.2, direction: 'down', tone: 'good' }
 * changeOf(1002, 1000)    // -> { ratio: 0.002, direction: 'flat', tone: 'neutral' }
 * changeOf(5, 0)          // -> { ratio: null, direction: 'up', tone: 'neutral' }
 * ```
 */
export function changeOf(current: number, previous: number, inverted = false): Change {
  if (previous === 0) {
    const direction = current > 0 ? 'up' : current < 0 ? 'down' : 'flat';
    return { ratio: null, direction, tone: 'neutral' };
  }
  return toned((current - previous) / Math.abs(previous), inverted);
}

/**
 * The change of a rate from `previous` to `current` in percentage points, both as ratios.
 * Flat within half a point; `inverted` marks a rate where lower is better.
 *
 * @example
 * ```ts
 * changeOfRate(0.12, 0.09)       // -> { ratio: 0.03, direction: 'up', tone: 'good', points: true }
 * changeOfRate(0.12, 0.09, true) // -> { ratio: 0.03, direction: 'up', tone: 'bad', points: true }
 * ```
 */
export function changeOfRate(current: number, previous: number, inverted = false): Change {
  return { ...toned(current - previous, inverted), points: true };
}

/**
 * A change of `ratio`, flat within `FLAT` either way.
 */
function toned(ratio: number, inverted: boolean): Change {
  if (Math.abs(ratio) < FLAT) return { ratio, direction: 'flat', tone: 'neutral' };
  const direction = ratio > 0 ? 'up' : 'down';
  return { ratio, direction, tone: (direction === 'up') !== inverted ? 'good' : 'bad' };
}
