import type { FieldChoice } from '../../../utils/index.ts';
import type { Message } from '../../messages/known-messages.ts';

import { literalUnion } from '../../../utils/codegen/index.ts';
import { checkChoice, choiceValues, isEmpty } from '../../../utils/index.ts';
import { matchingChoices } from '../choice.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

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
    choices: option<readonly FieldChoice<Message>[]>({ required: true }),

    /**
     * The control the dashboard edits the value with.
     * `'buttons'` renders the choices as a button group, for a short list that reads at a glance.
     * Presentation only: the stored value is the same either way.
     *
     * @default
     * 'dropdown'
     */
    display: option<'dropdown' | 'buttons'>({ default: 'dropdown' }),
  },
  emitType: (ctx) => literalUnion(choiceValues(ctx.options.choices)),
  validators: [(value, ctx) => failureMessage(checkChoice(value, ctx.options.choices))],
  search: (ctx) => {
    const values = matchingChoices(ctx.options.choices, ctx.token, ctx.resolveMessage);
    return isEmpty(values) ? null : { in: values };
  },
});
