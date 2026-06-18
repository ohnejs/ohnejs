/**
 * Whether a stream should be colored, judged by its `isTTY` flag.
 *
 * @example
 * ```ts
 * isColorStream({ isTTY: true })  // -> true
 * isColorStream({ isTTY: false }) // -> false
 * isColorStream(undefined)        // -> false
 * ```
 */
export function isColorStream(stream: { isTTY?: boolean } | undefined): boolean {
  return Boolean(stream?.isTTY);
}
