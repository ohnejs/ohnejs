import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';

/**
 * Keeps `target` as wide as `mirror`, re-measured whenever the mirror's border box changes.
 * The mirror shares the target's classes, so it measures with the same font and padding.
 * The observer disconnects with the enclosing scope.
 *
 * @example
 * ```ts
 * const shadow = h('span', { class: 'ohne-input-control ohne-input-shadow' }, () => model.value)
 * mirrorWidth(input, shadow)
 * ```
 */
export function mirrorWidth(target: HTMLElement, mirror: HTMLElement): void {
  // The border box, not the client rect: an overlay's entrance transform scales what a rect reports.
  const observer = new ResizeObserver(([entry]) => {
    const size = entry?.borderBoxSize[0];
    if (!isUndefined(size)) target.style.width = `${size.inlineSize}px`;
  });
  observer.observe(mirror);
  onCleanup(() => observer.disconnect());
}
