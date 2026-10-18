import { checkJSON, isInteger, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `json` field type: any plain JSON value, stored as JSON.
 *
 * The value type is `unknown`; a custom field type with validators gives the value a typed shape.
 * A top-level `null` is the field's `null`, while a nested `null` is ordinary data.
 * A value JSON would drop or distort, like `NaN`, a `Date` or a key set to `undefined`, is rejected.
 * Key order is not kept, so a `json` field can never be unique.
 * Word search never matches the value.
 */
export const json = defineField({
  columnType: 'json',
  search: false,
  unique: false,
  options: {
    /**
     * How deeply arrays and objects may nest inside the value; a scalar is depth 0.
     * Over the API the request body cap of 32 also applies, so a top-level value nests at most 31 deep.
     *
     * @default
     * 32
     */
    maxDepth: option<number>(),
  },
  validators: [(value, ctx) => failureMessage(checkJSON(value, ctx.options))],
  validateOptions: ({ options }) => maxDepthProblem(options.maxDepth),
});

/**
 * What makes a field's `maxDepth` unusable, as error body rows, or `undefined` when it holds.
 */
function maxDepthProblem(maxDepth: number | undefined): string[] | undefined {
  if (isUndefined(maxDepth) || (isInteger(maxDepth) && maxDepth >= 0)) return undefined;
  return [
    `\`maxDepth\` is \`${String(maxDepth)}\`, which is no depth.`,
    'Set it to a whole number of `0` or more.',
  ];
}
