import { isUndefined } from '../../utils/is/is-undefined.ts';
import { append, type Child } from './insert.ts';

/**
 * Attributes for `svg`: each value is stringified, and `undefined` leaves the attribute out.
 */
export type SVGAttributes = Record<string, string | number | undefined>;

const NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Creates an SVG element, the counterpart of `h` for the SVG namespace, typed by its tag.
 * Attributes are static; children append as `h` appends them, so text and reactive children work.
 *
 * @example
 * ```ts
 * svg('svg', { viewBox: '0 0 100 20' }, svg('path', { d: 'M0,10L100,10', stroke: 'currentColor' }))
 * // -> <svg viewBox="0 0 100 20"><path d="M0,10L100,10" stroke="currentColor"></path></svg>
 * ```
 */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: SVGAttributes = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (!isUndefined(value)) element.setAttribute(name, String(value));
  }
  for (const child of children) append(element, child);
  return element;
}
