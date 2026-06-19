const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * Compares two strings for natural, human-friendly ordering.
 * Digit runs compare by numeric value, so `'2'` sorts before `'11'`.
 *
 * Pass it straight to `Array.prototype.sort`.
 * Backed by a shared `Intl.Collator`, so ordering follows the runtime's default locale.
 *
 * @example
 * ```ts
 * ['file-11', 'file-2', 'file-1'].sort(naturalCompare)
 * // -> ['file-1', 'file-2', 'file-11']
 *
 * ['10kb', '2kb', '1kb'].sort(naturalCompare)
 * // -> ['1kb', '2kb', '10kb']
 * ```
 */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}
