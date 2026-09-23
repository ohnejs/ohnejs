/**
 * Matches each `tag` element by its exact name, attributes allowed, capturing its inner XML.
 * A self-closing `<tag/>` matches with no capture.
 *
 * @example
 * ```ts
 * '<a><Key>x</Key></a>'.match(elementPattern('Key'))?.[1] // -> 'x'
 * ```
 */
export function elementPattern(tag: string, flags = ''): RegExp {
  const name = RegExp.escape(tag);
  return new RegExp(`<${name}(?:\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, flags);
}
