import { codeSpan } from '../../utils/ansi/index.ts';
import { isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Throws when an entry of a layer's `dashboard.scriptSrc` is not one CSP source.
 * Entries land verbatim in the dashboard's `script-src` policy.
 * A space, `,` or `;` there would add sources or directives.
 *
 * @example
 * ```ts
 * validateScriptSrc(['https://cdn.example.com'], file)               // ok
 * validateScriptSrc(['https://cdn.example.com; script-src *'], file) // throws
 * ```
 */
export function validateScriptSrc(sources: string[], configFile: string): void {
  const invalid = sources.find((source) => source === '' || /[\s,;]/.test(source));
  if (isUndefined(invalid)) return;
  throw ohneError({
    title: `Invalid script source ${codeSpan(invalid)}`,
    body: [
      'Each entry in `dashboard.scriptSrc` must be one source, like `https://cdn.example.com`.',
      'Split a list into one entry per source, and drop any `;`.',
    ],
    path: configFile,
  });
}
