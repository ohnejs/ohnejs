import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { renderTemplate } from './render-template.ts';

/**
 * The label a record's values give it; `''` when no label field carries text.
 * A `template` renders through `renderTemplate`, a literal dropping beside an empty field.
 * Without one, the `fields` values join with single spaces in order, skipping empty ones.
 *
 * @example
 * ```ts
 * renderLabel({ first: 'Anduin', last: 'Wrynn' }, ['first', 'last'])
 * // -> 'Anduin Wrynn'
 *
 * renderLabel({ first: 'Anduin', last: 'Wrynn' }, ['last', 'first'], '{last}, {first}')
 * // -> 'Wrynn, Anduin'
 *
 * renderLabel({ first: '' }, ['first'])
 * // -> ''
 * ```
 */
export function renderLabel(
  values: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  template?: string,
): string {
  if (!isUndefined(template)) return renderTemplate(template, values);
  return fields
    .map((name) => values[name])
    .filter((value): value is string => isString(value) && value !== '')
    .join(' ');
}
