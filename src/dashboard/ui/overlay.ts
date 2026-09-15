import { css } from '../render/css.ts';

let count = 0;

/**
 * The selector every focus trap walks: anything reachable with Tab inside a floating surface.
 * One definition, so the traps in the floater and the popup agree on what counts as focusable.
 */
export const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// An anonymous layer, so every rule a raised component writes for itself outranks these UA undos.
css`
  @layer {
    [data-ohne-top-layer] {
      inset: auto;
      margin: 0;
      padding: 0;
      overflow: visible;
      background: transparent;
      border: none;
      color: inherit;
    }
  }
`;

/**
 * Raises a connected element into the browser's top layer, above the page and outside every clip.
 * A `container-type`, transform, or filter ancestor is otherwise a fixed panel's containing block.
 * The panel then takes its origin from that ancestor and crops at the nearest clipping one.
 * `el` keeps its place in the tree, so inherited values and descendant selectors still reach it.
 * The top layer stacks by entry, not by `z-index`; raising an already raised element moves it on top.
 * Leaving the document lowers the element again.
 *
 * @example
 * ```ts
 * raiseToTopLayer(panel)
 * ```
 */
export function raiseToTopLayer(el: HTMLElement): void {
  // An attribute, not a class: a reactive `class` binding rewrites the whole list and would drop it.
  el.setAttribute('data-ohne-top-layer', '');
  el.setAttribute('popover', 'manual');
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
}

/**
 * Pins `el` at the viewport coordinates `x`/`y` under `position: fixed`.
 * Only a top-layer element measures that way; one left in the page drifts by its containing block.
 */
export function placeFixed(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/**
 * A claim on one overlay depth, held from mount to unmount of a modal surface.
 */
export interface OverlayHandle {
  /**
   * The depth this overlay was opened at; the first overlay is `1`.
   * Hotkey instances pin themselves to a depth to stay live only inside their own overlay.
   */
  depth: number;

  /**
   * Whether this overlay is currently the topmost one.
   * A plain snapshot read, meant for event handlers.
   */
  isTopmost(): boolean;

  /**
   * Removes the `ohne-overlay-active` body class early when this is the only overlay.
   * Called at the start of a close transition, so the page un-dims while the surface animates out.
   */
  undim(): void;

  /**
   * Gives the depth back: decrements the counter and, at zero, un-dims the body.
   * Idempotent - a second call is a no-op.
   */
  release(): void;
}

/**
 * The number of currently open overlays.
 * Hotkeys read it to stand down while any overlay is open.
 *
 * Deliberately not reactive: an overlay acquires its depth from a mount timer and releases it on dispose.
 * A region that read a reactive count while creating an overlay would subscribe to its own bookkeeping.
 * Every acquire and release would then rebuild the region, forever.
 */
export function overlayCount(): number {
  return count;
}

/**
 * Claims the next overlay depth.
 *
 * The model is a bare counter plus the `ohne-overlay-active` body class.
 * There is no z-index allocation and no body scroll lock.
 * Popups sit at `z-index` 100, with DOM order breaking ties.
 * Everything that floats above them - panels, menus, toasts, tooltips - is raised to the top layer.
 * `raiseToTopLayer` puts them there, and the one raised last paints on top.
 * Closing assumes LIFO order: `undim` acts only when the counter is exactly 1.
 * Overlays closed out of order keep the body dimmed until the last one releases.
 *
 * @example
 * ```ts
 * const overlay = acquireOverlay()
 * onCleanup(overlay.release)
 * ```
 */
export function acquireOverlay(): OverlayHandle {
  count += 1;
  const depth = count;
  document.body.classList.add('ohne-overlay-active');
  let released = false;

  return {
    depth,
    isTopmost: () => count === depth,
    undim: () => {
      if (count === 1) {
        document.body.classList.remove('ohne-overlay-active');
      }
    },
    release: () => {
      if (released) return;
      released = true;
      count -= 1;
      if (count === 0) {
        document.body.classList.remove('ohne-overlay-active');
      }
    },
  };
}

/**
 * Calls `onOutside` for every click that lands outside `el`; returns the stop.
 * A press that STARTS inside `el` never counts, so a drag from inside to outside does not close.
 * Both listeners sit on `window` in the capture phase, ahead of anything a page stops.
 *
 * @example
 * ```ts
 * const stop = listenClickOutside(panel, () => close())
 * ```
 */
export function listenClickOutside(
  el: HTMLElement,
  onOutside: (event: MouseEvent) => void,
): () => void {
  let startedInside = false;
  const onPointerDown = (event: PointerEvent): void => {
    startedInside = event.target instanceof Node && el.contains(event.target);
  };
  const onClick = (event: MouseEvent): void => {
    const inside = event.target instanceof Node && el.contains(event.target);
    if (inside || startedInside) {
      startedInside = false;
      return;
    }
    onOutside(event);
  };
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('click', onClick, { capture: true, passive: true });
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('click', onClick, { capture: true });
  };
}
