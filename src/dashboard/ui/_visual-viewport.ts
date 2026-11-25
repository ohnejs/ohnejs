import { isNullish } from '../../utils/is/is-nullish.ts';

let tracking = false;

/**
 * Mirrors an on-screen keyboard that covers the page into `--ohne-keyboard-inset` and `--ohne-viewport-height`.
 * `--ohne-viewport-top` carries how far the browser panned the page up to show a focused input.
 * They land on `:root` while the keyboard is up and are removed when it closes, so the CSS fallbacks hold.
 * Installs once; without `visualViewport` nothing is written.
 *
 * @example
 * ```ts
 * trackVisualViewport()
 * ```
 */
export function trackVisualViewport(): void {
  const viewport = window.visualViewport;
  if (tracking || isNullish(viewport)) return;
  tracking = true;
  const style = document.documentElement.style;
  const update = (): void => {
    // A pinch zoom shrinks the visual viewport too, with no keyboard behind it.
    const covered =
      viewport.scale > 1 ? 0 : window.innerHeight - viewport.height - viewport.offsetTop;
    const inset = Math.max(0, Math.round(covered));
    if (inset === 0) {
      style.removeProperty('--ohne-keyboard-inset');
      style.removeProperty('--ohne-viewport-height');
      style.removeProperty('--ohne-viewport-top');
      return;
    }
    style.setProperty('--ohne-keyboard-inset', `${inset}px`);
    style.setProperty('--ohne-viewport-height', `${viewport.height}px`);
    style.setProperty('--ohne-viewport-top', `${Math.round(viewport.offsetTop)}px`);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}
