import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';

/**
 * A ref of `element`'s content width in whole pixels, kept current while the calling scope lives.
 * It reads `0` until the element is laid out, so draw nothing at `0`.
 * The observer disconnects with the enclosing scope.
 *
 * @example
 * ```ts
 * const root = h('div')
 * const width = useWidth(root)
 *
 * effect(() => draw(width.value)) // -> redraws whenever the box resizes
 * ```
 */
export function useWidth(element: Element): Readonly<Ref<number>> {
  const width = ref(0);
  const observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.floor(entry.contentRect.width);
  });
  observer.observe(element);
  onCleanup(() => observer.disconnect());
  return width;
}
