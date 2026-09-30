const ORIGIN = 'http://local.invalid';

/**
 * Returns whether `value` is a path on this origin: rooted at `/`, and still here once a browser parses it.
 * A browser drops tabs and newlines and reads `\` as `/`, so `/\t/evil.com` leaves the origin too.
 *
 * @example
 * ```ts
 * isLocalPath('/media')       // -> true
 * isLocalPath('//evil.com')   // -> false
 * isLocalPath('/\\evil')      // -> false
 * isLocalPath('/\t/evil.com') // -> false
 * isLocalPath('https://x')    // -> false
 * ```
 */
export function isLocalPath(value: string): boolean {
  return value.startsWith('/') && URL.parse(value, ORIGIN)?.origin === ORIGIN;
}
