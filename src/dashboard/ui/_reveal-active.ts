import { afterPaint } from '../../utils/frame/after-paint.ts';
import { effect } from '../../utils/reactive/effect.ts';

/**
 * Keeps the active item of a sideways-scrolling strip in view, centred where the strip allows.
 * It scrolls only the strip, never the page.
 * `active` is read reactively, so every change of the active item scrolls again after the next paint.
 *
 * @example
 * ```ts
 * revealActive(strip, () => model.value, '.ohne-button-group-item-active')
 * ```
 */
export function revealActive(strip: HTMLElement, active: () => unknown, selector: string): void {
  effect(() => {
    void active();
    void afterPaint().then(() => {
      if (!strip.isConnected) return;
      const item = strip.querySelector<HTMLElement>(selector);
      if (!item || strip.scrollWidth <= strip.clientWidth) return;
      const box = item.getBoundingClientRect();
      const offset = box.left - strip.getBoundingClientRect().left;
      strip.scrollLeft += offset - (strip.clientWidth - box.width) / 2;
    });
  });
}
