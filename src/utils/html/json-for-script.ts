/**
 * Serializes `value` to JSON safe to embed inside an HTML `<script>` element.
 * Every `<` becomes its JSON unicode escape, so an embedded `</script>` cannot close the element early.
 *
 * @example
 * ```ts
 * jsonForScript({ note: '</script>' }).includes('<') // -> false
 * ```
 */
export function jsonForScript(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/</g, '\\u003c');
}
