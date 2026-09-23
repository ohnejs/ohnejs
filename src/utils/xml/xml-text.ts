import { isNull } from '../is/is-null.ts';
import { elementPattern } from './_element.ts';
import { decodeXMLEntities } from './decode-xml-entities.ts';

/**
 * Returns the entity-decoded text of the first `tag` element in `xml`, or `undefined` when there is none.
 * Names match exactly, so `Key` never matches `KeyCount`; a self-closing element is `''`.
 * Reach for it on the leaf elements of a small, trusted response, not as a general XML parser.
 *
 * @example
 * ```ts
 * xmlText('<Error><Code>NoSuchKey</Code></Error>', 'Code') // -> 'NoSuchKey'
 * xmlText('<R><Key>a &amp; b</Key></R>', 'Key')            // -> 'a & b'
 * xmlText('<R><KeyCount>0</KeyCount></R>', 'Key')          // -> undefined
 * xmlText('<R><Prefix/></R>', 'Prefix')                    // -> ''
 * ```
 */
export function xmlText(xml: string, tag: string): string | undefined {
  const match = elementPattern(tag).exec(xml);
  return isNull(match) ? undefined : decodeXMLEntities(match[1] ?? '');
}
