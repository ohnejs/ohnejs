import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { parseTemplate } from './parse-template.ts';

/**
 * Renders a brace template from `values`, dropping what is absent.
 * A field renders when its value is a non-empty string; any other value leaves it absent.
 * A leading or trailing literal renders only beside a rendered field.
 * Between two rendered fields, only the literal just before the later field renders.
 * A malformed template returns unchanged.
 *
 * @example
 * ```ts
 * renderTemplate('{city}, {country}', { city: 'Vienna', country: 'Austria' })
 * // -> 'Vienna, Austria'
 *
 * renderTemplate('{city}, {country}', { country: 'Austria' })
 * // -> 'Austria'
 *
 * renderTemplate('{city}, {region}, {country}', { city: 'Vienna', country: 'Austria' })
 * // -> 'Vienna, Austria'
 * ```
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  const segments = parseTemplate(template);
  if (isUndefined(segments)) return template;
  const texts = segments.map((segment) =>
    segment.kind === 'field' ? fieldText(values[segment.name]) : segment.text,
  );
  const last = segments.length - 1;
  let label = '';
  let filled = false;
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'field') {
      label += texts[index] ?? '';
      filled ||= present(texts, index);
    } else if (
      index === last
        ? present(texts, index - 1)
        : present(texts, index + 1) && (index === 0 || filled)
    ) {
      label += segment.text;
    }
  }
  return label;
}

/**
 * A field's rendered text, or `undefined` when its value is not a non-empty string.
 */
function fieldText(value: unknown): string | undefined {
  return isString(value) && value !== '' ? value : undefined;
}

/**
 * Whether the segment at `index` renders; an out-of-range neighbor is an edge and never blocks.
 */
function present(texts: readonly (string | undefined)[], index: number): boolean {
  return index < 0 || index >= texts.length || !isUndefined(texts[index]);
}
