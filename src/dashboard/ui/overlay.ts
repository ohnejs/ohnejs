import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';

const count = ref(0);

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
   * Reactive: reading inside an effect re-runs it when the depth changes.
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
 * Reactive: reading inside an effect subscribes it.
 * Hotkeys read it to stand down while any overlay is open.
 */
export function overlayCount(): number {
  return count.value;
}

/**
 * Claims the next overlay depth, ported 1-to-1 from Pruvious v4's popup bookkeeping.
 *
 * The model is a bare counter plus the `ohne-overlay-active` body class - there is no z-index
 * allocation and no body scroll lock.
 * Stacking is a fixed ladder: popups sit at `z-index` 100 (DOM order breaks ties), floating panels
 * at 99997, toasts at 99998, tooltips at 99999.
 * Closing assumes LIFO order: `undim` acts only when the counter is exactly 1, so overlays closed
 * out of order keep the body dimmed until the last one releases.
 *
 * @example
 * ```ts
 * const overlay = acquireOverlay()
 * onCleanup(overlay.release)
 * ```
 */
export function acquireOverlay(): OverlayHandle {
  count.value += 1;
  const depth = untracked(() => count.value);
  document.body.classList.add('ohne-overlay-active');
  let released = false;

  return {
    depth,
    isTopmost: () => count.value === depth,
    undim: () => {
      if (untracked(() => count.value) === 1) {
        document.body.classList.remove('ohne-overlay-active');
      }
    },
    release: () => {
      if (released) return;
      released = true;
      count.value -= 1;
      if (untracked(() => count.value) === 0) {
        document.body.classList.remove('ohne-overlay-active');
      }
    },
  };
}

/**
 * Hides an element's scrollbars while a floating surface is open; returns the restore.
 * The stored `overflow` inline style is put back exactly, so nested locks release in LIFO order.
 * Pass `document.documentElement` to lock the window.
 *
 * @example
 * ```ts
 * const unlock = lockScroll(document.documentElement)
 * unlock()
 * ```
 */
export function lockScroll(el: HTMLElement): () => void {
  const initial = el.style.overflow;
  el.style.overflow = 'hidden';
  return () => {
    el.style.overflow = initial;
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
