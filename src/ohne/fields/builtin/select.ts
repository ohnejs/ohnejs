import type { FieldChoice } from '../choice.ts';

import { literalUnion } from '../../../utils/codegen/index.ts';
import { isEmpty } from '../../../utils/index.ts';
import { choiceValues, matchingChoices } from '../choice.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `select` field type: one value out of a declared choice list.
 *
 * Stores the chosen value as text; the generated value type is the union of the choice values.
 * A value outside the list rejects, so the union is a promise the runtime keeps.
 * Search matches the choices whose value or label has a word starting with the token.
 */
export const select = defineField({
  columnType: 'text',
  options: {
    /**
     * The values this field admits.
     * A plain string is both the stored value and its display text.
     * The object form pairs the stored value with a translatable display label.
     */
    choices: option<readonly FieldChoice[]>({ required: true }),
  },
  emitType: (ctx) => literalUnion(choiceValues(ctx.options.choices)),
  validators: [
    (value, ctx) =>
      choiceValues(ctx.options.choices).includes(value) ? undefined : 'validation.invalidChoice',
  ],
  search: (ctx) => {
    const values = matchingChoices(ctx.options.choices, ctx.token, ctx.resolveMessage);
    return isEmpty(values) ? null : { in: values };
  },
});
