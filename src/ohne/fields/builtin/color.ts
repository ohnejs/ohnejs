import {
  checkColor,
  duplicates,
  formatHexColor,
  isUndefined,
  parseHexColor,
} from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `color` field type: a hex color, stored as lowercase `#rrggbb`.
 *
 * Any hex spelling is accepted and stored in one form, so `#F80` and `#ff8800` are the same value.
 * A translucent color is rejected unless the field sets `alpha`; then it stores as `#rrggbbaa`.
 * Search is off until a field sets `search: true`.
 */
export const color = defineField({
  columnType: 'text',
  search: { default: false },
  options: {
    /**
     * Whether a translucent color is legal, stored with its alpha channel as `#rrggbbaa`.
     *
     * @default
     * false
     */
    alpha: option({ default: false }),

    /**
     * Colors the dashboard offers to pick from, in any hex spelling.
     * They suggest; any other color stays legal.
     */
    swatches: option<readonly string[]>(),
  },
  emitType: () => '`#${string}`',
  sanitizers: [
    (value) => {
      const parsed = parseHexColor(value);
      return isUndefined(parsed) ? value : formatHexColor(parsed);
    },
  ],
  validators: [(value, ctx) => failureMessage(checkColor(value, ctx.options))],
  validateOptions: ({ options }) => swatchesProblem(options.swatches ?? [], options.alpha),
});

/**
 * What makes a field's `swatches` unusable, as error body rows, or `undefined` when they hold.
 * Every swatch must be a hex color the field accepts, and no two may name the same color.
 */
function swatchesProblem(swatches: readonly string[], alpha: boolean): string[] | undefined {
  const colors = swatches.map((swatch) => parseHexColor(swatch));
  const invalid = swatches.find((_, at) => isUndefined(colors[at]));
  if (!isUndefined(invalid)) {
    return [
      `\`swatches\` holds \`${invalid}\`, which is no hex color.`,
      'Write each swatch as `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.',
    ];
  }
  const translucent = alpha ? undefined : swatches.find((_, at) => colors[at]!.a !== 255);
  if (!isUndefined(translucent)) {
    return [
      `\`swatches\` holds the translucent \`${translucent}\`, but the field takes no \`alpha\`.`,
      'Make the swatch opaque, or set `alpha: true`.',
    ];
  }
  const repeated = duplicates(colors.map((parsed) => formatHexColor(parsed!)));
  if (repeated.length === 0) return undefined;
  return [
    '`swatches` names a color more than once.',
    'Drop the duplicates:',
    '',
    ...repeated.map((value) => `- \`${value}\``),
  ];
}
