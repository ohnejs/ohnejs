import { longPress } from './_long-press.ts';

/**
 * A chip's own touch handlers, spread onto its element's props.
 */
export interface ChipTouchHandlers {
  /**
   * Arms the hold.
   */
  onTouchstart: (event: TouchEvent) => void;

  /**
   * Drops the hold once the finger moves past the slop.
   */
  onTouchmove: (event: TouchEvent) => void;

  /**
   * Ends a hold, or counts the tap towards a double tap.
   */
  onTouchend: (event: TouchEvent) => void;

  /**
   * Drops the hold.
   */
  onTouchcancel: () => void;

  /**
   * Keeps the long-press menu shut while a finger is down.
   */
  onContextmenu: (event: MouseEvent) => void;
}

/**
 * Wires a chip's touch gestures without taking the touch from the page.
 * A still hold of `duration` milliseconds calls `onHold`, which starts a touch drag.
 * A finger that drifts past the slop, or a cancelled touch, drops the hold.
 * So a swipe that starts on the chip scrolls the page.
 * A second tap within 300ms calls `onDoubleTap`, the touch twin of a double-click.
 * A hold or a double tap cancels its compatibility mouse events, so no mousedown or click follows.
 * Leaving the scope drops a pending hold.
 *
 * @example
 * ```ts
 * h('li', { ...chipTouch(500, () => startDrag(index), (event) => open(value, event)) })
 * ```
 */
export function chipTouch(
  duration: number,
  onHold: () => void,
  onDoubleTap?: (event: TouchEvent) => void,
): ChipTouchHandlers {
  const press = longPress(duration, onHold);
  let down = false;
  let lastTap = -Infinity;

  return {
    onTouchstart: (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      down = true;
      press.start(touch);
    },
    onTouchmove: (event) => {
      const touch = event.touches[0];
      if (!touch || !press.pending()) return;
      press.move(touch);
      if (!press.pending()) lastTap = -Infinity;
    },
    onTouchend: (event) => {
      // A child that kept its touchstart, like the remove button, owns the tap that ends here.
      if (!down) return;
      const tapped = press.pending();
      down = false;
      if (press.end()) {
        event.preventDefault();
      } else if (tapped && event.timeStamp - lastTap < 300) {
        lastTap = -Infinity;
        event.preventDefault();
        onDoubleTap?.(event);
      } else if (tapped) {
        lastTap = event.timeStamp;
      }
    },
    onTouchcancel: () => {
      down = false;
      press.end();
    },
    onContextmenu: (event) => {
      if (down) event.preventDefault();
    },
  };
}
