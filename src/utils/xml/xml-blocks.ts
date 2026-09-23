import { elementPattern } from './_element.ts';

/**
 * Returns the raw inner XML of every `tag` element in `xml`, in document order.
 * Names match exactly, so `Key` never matches `KeyCount`; a self-closing element yields `''`.
 * Elements of the same name must not nest, as in the flat lists web APIs return.
 *
 * @example
 * ```ts
 * xmlBlocks('<R><Part><N>1</N></Part><Part><N>2</N></Part></R>', 'Part')
 * // -> ['<N>1</N>', '<N>2</N>']
 *
 * xmlBlocks('<R><Part/></R>', 'Part')
 * // -> ['']
 * ```
 */
export function xmlBlocks(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(elementPattern(tag, 'g')), (match) => match[1] ?? '');
}
