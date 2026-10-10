import { codeSpan } from '../../utils/ansi/index.ts';
import { isOrigin, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Throws when an entry of a layer's `dashboard.frameAncestors` is not a bare http(s) origin.
 * Entries land verbatim in the dashboard's `frame-ancestors` policy, where a wildcard or a `;` would widen it.
 * When the entry parses to a valid origin, the error suggests it.
 *
 * @example
 * ```ts
 * validateFrameAncestors(['https://example.com'], file)   // ok
 * validateFrameAncestors(['https://example.com/'], file)  // throws, suggests `https://example.com`
 * validateFrameAncestors(['https://*.example.com'], file) // throws
 * ```
 */
export function validateFrameAncestors(origins: string[], configFile: string): void {
  const invalid = origins.find((origin) => !isOrigin(origin));
  if (isUndefined(invalid)) return;
  const suggestion = URL.parse(invalid)?.origin;
  throw ohneError({
    title: `Invalid frame ancestor ${codeSpan(invalid)}`,
    body: [
      'Each entry in `dashboard.frameAncestors` must be a bare origin, like `https://example.com`.',
      'Drop any path, trailing slash, wildcard or quoted keyword.',
      ...(isOrigin(suggestion) ? ['', `Did you mean ${codeSpan(suggestion)}?`] : []),
    ],
    path: configFile,
  });
}
