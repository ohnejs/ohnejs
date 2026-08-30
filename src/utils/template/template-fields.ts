import { isUndefined } from '../is/is-undefined.ts';
import { parseTemplate } from './parse-template.ts';

/**
 * The names a brace template's `{name}` tokens carry, in order, repeats kept.
 * Returns `undefined` when the template is malformed.
 *
 * @example
 * ```ts
 * templateFields('{lastName}, {firstName}') // -> ['lastName', 'firstName']
 * templateFields('{oops')                   // -> undefined
 * ```
 */
export function templateFields(template: string): string[] | undefined {
  const segments = parseTemplate(template);
  if (isUndefined(segments)) return undefined;
  return segments.flatMap((segment) => (segment.kind === 'field' ? [segment.name] : []));
}
