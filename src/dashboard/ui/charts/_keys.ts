import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { clamp } from '../../../utils/number/clamp.ts';

const STEPS: Record<'x' | 'y', Record<string, number>> = {
  x: { ArrowLeft: -1, ArrowRight: 1 },
  y: { ArrowUp: -1, ArrowDown: 1 },
};

/**
 * The position a chart's key press moves to among `count` positions, from `at` or else the last.
 * The arrows along `axis` step, Home and End jump to the ends, and Escape clears to `null`.
 * Any other key, or a press with no positions, answers `undefined`, so the chart leaves the event alone.
 */
export function keyStep(
  key: string,
  at: number | null,
  count: number,
  axis: 'x' | 'y' = 'x',
): number | null | undefined {
  if (count === 0) return undefined;
  if (key === 'Escape') return null;
  const last = count - 1;
  const step = STEPS[axis][key];
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return isUndefined(step) ? undefined : clamp((at ?? last) + step, 0, last);
}
