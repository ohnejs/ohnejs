import {
  checkJSONText,
  checkText,
  isInteger,
  isUndefined,
  languageOf,
  parseFieldPath,
} from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `code` field type: source text, stored as written with its line endings as `\n`.
 *
 * Non-empty by default: it rejects `''` unless `allowEmpty` is set.
 * Under `language: 'json'` a value must parse as JSON; its formatting is kept as written.
 * Search is off until a field sets `search: true`.
 */
export const code = defineField({
  columnType: 'text',
  search: { default: false },
  options: {
    /**
     * Whether an empty string is a legal value.
     *
     * @default
     * false
     */
    allowEmpty: option({ default: false }),

    /**
     * The fewest characters a value may hold.
     */
    min: option<number>(),

    /**
     * The most characters a value may hold.
     */
    max: option<number>(),

    /**
     * The language the dashboard highlights, as a name, an alias or a file extension.
     * A language nothing registered renders plain.
     * `json` also rejects a value that does not parse.
     */
    language: option<string>(),

    /**
     * A sibling field path, in `when` syntax, whose value names the language or a file path.
     * Only the dashboard reads it, so it highlights and never validates.
     */
    languageFrom: option<string>(),

    /**
     * What Tab inserts in the dashboard: that many spaces, or a tab rendered four columns wide.
     *
     * @default
     * 2
     */
    indent: option<number | 'tab'>({ default: 2 }),

    /**
     * Whether the dashboard soft-wraps long lines.
     *
     * @default
     * false
     */
    wrap: option({ default: false }),
  },
  sanitizers: [(value) => value.replace(/\r\n?/g, '\n')],
  validators: [
    (value, ctx) => failureMessage(checkText(value, ctx.options)),
    (value, ctx) =>
      value !== '' && languageOf(ctx.options.language ?? '') === 'json'
        ? failureMessage(checkJSONText(value))
        : undefined,
  ],
  validateOptions: ({ options }) => boundsProblem(options) ?? codeProblem(options),
});

/**
 * What makes a field's language or `indent` unusable, as error body rows, or `undefined` when they hold.
 */
function codeProblem(options: {
  language?: string;
  languageFrom?: string;
  indent: number | 'tab';
}): string[] | undefined {
  const { language, languageFrom, indent } = options;
  if (!isUndefined(language) && !isUndefined(languageFrom)) {
    return [
      'The field sets both `language` and `languageFrom`.',
      'Keep `language` for a fixed language, or `languageFrom` to follow a sibling field.',
    ];
  }
  if (!isUndefined(languageFrom) && isUndefined(parseFieldPath(languageFrom))) {
    return [
      `\`languageFrom\` is \`${languageFrom}\`, which is no field path.`,
      'Write it as `when` does: `language`, `../file.path` or `/kind`.',
    ];
  }
  if (indent === 'tab' || (isInteger(indent) && indent >= 1 && indent <= 8)) return undefined;
  return [
    `\`indent\` is \`${String(indent)}\`, which the field cannot use.`,
    "Write it as `'tab'`, or a whole number of spaces from `1` to `8`.",
  ];
}
