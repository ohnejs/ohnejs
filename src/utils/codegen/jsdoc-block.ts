/**
 * Wraps `content` as a JSDoc block comment: one `*`-prefixed line per line of `content`.
 *
 * A blank line becomes a bare ` *`, so paragraph and section breaks survive.
 * A `*` immediately before a `/` is split with a backslash, so `content` cannot close the block early.
 * The result carries no outer indentation; the emission site indents the whole block as one unit.
 *
 * @example
 * ```ts
 * jsdocBlock('A page title.')
 * // -> '/**\n * A page title.\n *\/'
 *
 * jsdocBlock('First line.\n\nSecond paragraph.')
 * // -> '/**\n * First line.\n *\n * Second paragraph.\n *\/'
 * ```
 */
export function jsdocBlock(content: string): string {
  const lines = ['/**'];
  for (const line of content.split('\n')) {
    lines.push(line.length === 0 ? ' *' : ` * ${line.replaceAll('*/', '*\\/')}`);
  }
  lines.push(' */');
  return lines.join('\n');
}
