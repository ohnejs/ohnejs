import { isUndefined } from '../is/is-undefined.ts';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;

/**
 * Decodes the XML entities in `value`: the predefined named ones and numeric character references.
 * One pass, so `&amp;lt;` decodes to `&lt;`, never to `<`.
 * An unknown entity stays as written.
 *
 * @example
 * ```ts
 * decodeXMLEntities('a &amp; b')   // -> 'a & b'
 * decodeXMLEntities('&#x41;&#66;') // -> 'AB'
 * decodeXMLEntities('&amp;lt;')    // -> '&lt;'
 * decodeXMLEntities('&nbsp;')      // -> '&nbsp;'
 * ```
 */
export function decodeXMLEntities(value: string): string {
  return value.replace(ENTITY, (entity, hex?: string, decimal?: string, name?: string) => {
    if (!isUndefined(name)) return NAMED[name]!;
    const code = isUndefined(hex) ? Number(decimal) : parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
