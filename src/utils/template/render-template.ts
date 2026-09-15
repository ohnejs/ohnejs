import type { TemplateSegment } from './parse-template.ts';

import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { parseTemplate } from './parse-template.ts';

/**
 * Renders a brace template from `values`, dropping what is absent.
 * A field renders when its value is a non-empty string; any other value leaves it absent.
 * A literal renders only when every field beside it renders, so a separator drops with its field.
 * A malformed template returns unchanged.
 *
 * @example
 * ```ts
 * renderTemplate('{city}, {country}', { city: 'Vienna', country: 'Austria' })
 * // -> 'Vienna, Austria'
 *
 * renderTemplate('{city}, {country}', { city: 'Vienna' })
 * // -> 'Vienna'
 *
 * renderTemplate('{city}, {country}', { country: 'Austria' })
 * // -> 'Austria'
 * ```
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  const segments = parseTemplate(template);
  if (isUndefined(segments)) return template;
  const rendered = segments.map((segment) =>
    segment.kind === 'field' ? fieldText(values[segment.name]) : segment.text,
  );
  let label = '';
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'field') {
      label += rendered[index] ?? '';
    } else if (present(segments, rendered, index - 1) && present(segments, rendered, index + 1)) {
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
function present(
  segments: readonly TemplateSegment[],
  rendered: readonly (string | undefined)[],
  index: number,
): boolean {
  return index < 0 || index >= segments.length || !isUndefined(rendered[index]);
}
