/**
 * Matches each `tag` element by its exact name, attributes allowed, capturing its inner XML.
 * A quoted attribute value may hold `>` or `/>`, so the start tag ends only outside the quotes.
 * A self-closing `<tag/>` matches with no capture.
 *
 * @example
 * ```ts
 * '<a><Key>x</Key></a>'.match(elementPattern('Key'))?.[1] // -> 'x'
 * ```
 */
export function elementPattern(tag: string, flags = ''): RegExp {
  const name = RegExp.escape(tag);
  const attributes = `(?:\\s(?:[^>"'/]|"[^"]*"|'[^']*'|/(?!>))*)?`;
  return new RegExp(`<${name}${attributes}(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, flags);
}
