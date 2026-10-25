import type { ScreenPoint } from './floater-place.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';

/**
 * The state of one long-press gesture, fed by its caller's touch or pointer events.
 */
export interface LongPress {
  /**
   * Arms the hold at the point the finger went down.
   */
  start(point: ScreenPoint): void;

  /**
   * Drops the pending hold once the finger drifts past `TOUCH_SLOP`, so the gesture stays a scroll.
   */
  move(point: ScreenPoint): void;

  /**
   * Drops the pending hold, and returns whether it fired since the last `start`.
   */
  end(): boolean;

  /**
   * Whether a hold is armed and has not yet fired.
   */
  pending(): boolean;

  /**
   * Whether the hold fired since the last `start`.
   */
  held(): boolean;
}

/**
 * How far in pixels a finger may drift while it holds still.
 */
export const TOUCH_SLOP = 10;

/**
 * Tracks a long-press: a finger that holds still for `duration` milliseconds calls `onHold`.
 * A finger that drifts past `TOUCH_SLOP` first drops the hold.
 * Leaving the scope drops a pending hold.
 *
 * @example
 * ```ts
 * const press = longPress(500, () => startDrag())
 * h('li', {
 *   onTouchstart: (event: TouchEvent) => press.start(event.touches[0]!),
 *   onTouchmove: (event: TouchEvent) => press.move(event.touches[0]!),
 *   onTouchend: () => press.end(),
 *   onTouchcancel: () => press.end(),
 * })
 * ```
 */
export function longPress(duration: number, onHold: () => void): LongPress {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: ScreenPoint | undefined;
  let fired = false;

  const drop = (): void => {
    clearTimeout(timer);
    origin = undefined;
  };
  onCleanup(drop);

  return {
    start: (point) => {
      drop();
      fired = false;
      origin = { clientX: point.clientX, clientY: point.clientY };
      timer = setTimeout(() => {
        origin = undefined;
        fired = true;
        onHold();
      }, duration);
    },
    move: (point) => {
      if (isUndefined(origin)) return;
      const drift = Math.hypot(point.clientX - origin.clientX, point.clientY - origin.clientY);
      if (drift > TOUCH_SLOP) drop();
    },
    end: () => {
      drop();
      return fired;
    },
    pending: () => !isUndefined(origin),
    held: () => fired,
  };
}
