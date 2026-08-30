/**
 * One parsed segment of a brace template.
 * Discriminated by `kind`.
 */
export type TemplateSegment = TemplateLiteral | TemplateField;

/**
 * Raw text between fields, emitted verbatim.
 */
export interface TemplateLiteral {
  /**
   * Discriminant.
   */
  readonly kind: 'literal';

  /**
   * The text to emit.
   */
  readonly text: string;
}

/**
 * One `{name}` field token.
 */
export interface TemplateField {
  /**
   * Discriminant.
   */
  readonly kind: 'field';

  /**
   * The name between the braces, trimmed.
   */
  readonly name: string;
}

/**
 * Parses a brace template like `'{lastName}, {firstName}'` into its segments.
 * A `{name}` token becomes a field segment; the text around tokens becomes literal segments.
 * Empty literals are never emitted, so a literal's neighbors are always fields or edges.
 * Returns `undefined` for a malformed template: a stray brace, an unclosed token, or an empty `{}`.
 *
 * @example
 * ```ts
 * parseTemplate('{a} - {b}')
 * // -> [{ kind: 'field', name: 'a' }, { kind: 'literal', text: ' - ' }, { kind: 'field', name: 'b' }]
 *
 * parseTemplate('{oops')
 * // -> undefined
 * ```
 */
export function parseTemplate(template: string): TemplateSegment[] | undefined {
  const segments: TemplateSegment[] = [];
  let literal = '';
  let index = 0;
  while (index < template.length) {
    const char = template[index]!;
    if (char === '}') return undefined;
    if (char !== '{') {
      literal += char;
      index += 1;
      continue;
    }
    const end = template.indexOf('}', index + 1);
    if (end === -1) return undefined;
    const name = template.slice(index + 1, end).trim();
    if (name === '' || name.includes('{')) return undefined;
    if (literal !== '') segments.push({ kind: 'literal', text: literal });
    literal = '';
    segments.push({ kind: 'field', name });
    index = end + 1;
  }
  if (literal !== '') segments.push({ kind: 'literal', text: literal });
  return segments;
}
