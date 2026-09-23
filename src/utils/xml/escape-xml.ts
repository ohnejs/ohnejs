const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const SPECIAL = /[&<>"']/g;

/**
 * Escapes the XML special characters in `value`, so it is safe as element text or an attribute value.
 * `decodeXMLEntities` reverses it.
 *
 * @example
 * ```ts
 * escapeXML('a & b')  // -> 'a &amp; b'
 * escapeXML('<Key>')  // -> '&lt;Key&gt;'
 * escapeXML(`"it's"`) // -> '&quot;it&apos;s&quot;'
 * ```
 */
export function escapeXML(value: string): string {
  return value.replace(SPECIAL, (ch) => ENTITIES[ch]!);
}
