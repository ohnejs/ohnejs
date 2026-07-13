/**
 * Selects the singular or plural form of a noun to agree with a count.
 *
 * Returns `singular` when the count is exactly one, in either direction, and `plural` otherwise.
 * When `plural` is omitted it defaults to `singular` with an `s` appended, covering regular nouns.
 * Pass it for irregular plurals like `'entries'` or `'indices'`.
 * The count is not part of the result, so the caller keeps full control over how the number renders.
 *
 * @example
 * ```ts
 * pluralize(1, 'row')              // -> 'row'
 * pluralize(0, 'row')              // -> 'rows'
 * pluralize(3, 'row')              // -> 'rows'
 * pluralize(1, 'entry', 'entries') // -> 'entry'
 * pluralize(2, 'entry', 'entries') // -> 'entries'
 *
 * `${n} ${pluralize(n, 'file')}`   // -> '1 file' / '2 files'
 * ```
 */
export function pluralize(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return Math.abs(count) === 1 ? singular : plural;
}
