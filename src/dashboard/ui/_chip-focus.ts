import { nextTick } from '../../utils/reactive/next-tick.ts';

/**
 * Keeps focus in a chips list after the chip at `index` is removed by its X button.
 * Once the list re-renders, focus moves to the X now at `index`, else the one before it, else `fallback`.
 * It only steps in when focus fell to the body with the removed chip, so a surviving focused X stays.
 */
export function refocusAfterRemoval(
  list: Element | null,
  selector: string,
  index: number,
  fallback: () => void,
): void {
  void nextTick().then(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const removes = [...(list?.querySelectorAll<HTMLElement>(selector) ?? [])];
    const target = removes[index] ?? removes[index - 1];
    if (target) target.focus({ preventScroll: true });
    else fallback();
  });
}
