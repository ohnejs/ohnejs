import { isNull } from '../../../utils/is/is-null.ts';
import { ref } from '../../../utils/reactive/ref.ts';

/**
 * The sheet's checked rows, keyed by row key - the set a bulk action like delete operates on.
 * It lives beside the cursor selection and never follows it.
 * Every read is reactive.
 */
export interface RowChecks {
  /**
   * The checked row keys.
   */
  keys(): ReadonlySet<string>;

  /**
   * Whether the row is checked.
   */
  has(key: string): boolean;

  /**
   * The number of checked rows.
   */
  count(): number;

  /**
   * Flips one row.
   * With `extend`, the flipped row's new state applies across the span from the previously toggled row.
   * `all` supplies the page's row keys in order.
   * Extending with no previously toggled row flips the one row.
   */
  toggle(key: string, index: number, all: readonly string[], extend?: boolean): void;

  /**
   * Checks exactly these keys.
   */
  setAll(keys: readonly string[]): void;

  /**
   * Unchecks everything.
   */
  clear(): void;
}

/**
 * Creates an empty row-check model.
 * The model is DOM-free; the sheet component binds it to the gutter ticks and keys.
 */
export function createRowChecks(): RowChecks {
  const checked = ref<ReadonlySet<string>>(new Set());
  let last: number | null = null;

  return {
    keys: () => checked.value,
    has: (key) => checked.value.has(key),
    count: () => checked.value.size,
    toggle(key, index, all, extend = false) {
      const next = new Set(checked.value);
      const on = !next.has(key);
      if (extend && !isNull(last)) {
        const [from, to] = last < index ? [last, index] : [index, last];
        for (let i = from; i <= to; i += 1) {
          if (on) next.add(all[i]);
          else next.delete(all[i]);
        }
      } else if (on) next.add(key);
      else next.delete(key);
      last = index;
      checked.value = next;
    },
    setAll(keys) {
      checked.value = new Set(keys);
      last = null;
    },
    clear() {
      checked.value = new Set();
      last = null;
    },
  };
}
