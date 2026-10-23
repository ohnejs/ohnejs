import { ref } from '../../utils/reactive/ref.ts';

const changes = ref(0);

/**
 * Counts the `markDataChanged` calls since the page loaded; every read is reactive.
 * A page that loads server data reads it to reload once a write outside the page changed that data.
 *
 * @example
 * ```ts
 * effect(() => {
 *   dataChangeCount()
 *   void loadRows()
 * })
 * ```
 */
export function dataChangeCount(): number {
  return changes.value;
}

/**
 * Tells every page on screen that a write it did not send changed the server's data.
 *
 * @example
 * ```ts
 * await api('DELETE /collections/posts/p1')
 * markDataChanged()
 * ```
 */
export function markDataChanged(): void {
  changes.value += 1;
}
