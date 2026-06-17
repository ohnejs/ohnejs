const RESERVED = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * Coerces any string into a valid, non-reserved JavaScript identifier.
 *
 * Runs of characters that are not `A-Z`, `a-z`, `0-9`, `_` or `$` collapse into a single `_`.
 * A leading digit, an empty result, or a reserved word is prefixed with `_`.
 *
 * This is the safety net for names built from arbitrary input.
 * When you want a readable name from a file path, reach for `pathToCamelName` first.
 *
 * @example
 * ```ts
 * toIdentifier('foo-bar')      // -> 'foo_bar'
 * toIdentifier('2cool')        // -> '_2cool'
 * toIdentifier('class')        // -> '_class'
 * toIdentifier('user.profile') // -> 'user_profile'
 * ```
 */
export function toIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]+/g, '_');
  if (cleaned.length === 0 || /^[0-9]/.test(cleaned) || RESERVED.has(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}
