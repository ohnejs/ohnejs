import { getOrSet } from '../../utils/map/get-or-set.ts';

const locks = new Map<object, { initial: string; holders: number }>();

/**
 * Hides an element's scrollbars while a floating surface is open; returns the restore.
 * Overlapping locks on one element share it: the first stores the inline `overflow`, the last puts it back.
 * Releases may come in any order; a repeated release is a no-op.
 * Pass `document.documentElement` to lock the window.
 *
 * @example
 * ```ts
 * const unlock = lockScroll(document.documentElement)
 * unlock()
 * ```
 */
export function lockScroll(el: { style: { overflow: string } }): () => void {
  const lock = getOrSet(locks, el, () => ({ initial: el.style.overflow, holders: 0 }));
  lock.holders += 1;
  el.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.holders -= 1;
    if (lock.holders > 0) return;
    locks.delete(el);
    el.style.overflow = lock.initial;
  };
}
