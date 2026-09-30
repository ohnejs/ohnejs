import type { Message } from '../../messages/known-messages.ts';

import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `boolean` field type: a true or false value.
 */
export const boolean = defineField({
  columnType: 'boolean',
  options: {
    /**
     * The control the dashboard edits the value with.
     * `'buttons'` renders a two-choice button group labeled by `falseLabel` and `trueLabel`.
     * Presentation only: the stored value is a plain boolean either way.
     *
     * @default
     * 'checkbox'
     */
    display: option<'checkbox' | 'switch' | 'buttons'>({ default: 'checkbox' }),

    /**
     * The `true` choice's label under `display: 'buttons'`.
     * Pass a message key to translate it per the viewer's language.
     * Omitted, the choice reads "Yes" in the viewer's language.
     *
     * @example
     * ```ts
     * 'Enabled'
     * 'app.flags.enabled'
     * ```
     */
    trueLabel: option<Message>(),

    /**
     * The `false` choice's label under `display: 'buttons'`.
     * Pass a message key to translate it per the viewer's language.
     * Omitted, the choice reads "No" in the viewer's language.
     *
     * @example
     * ```ts
     * 'Disabled'
     * 'app.flags.disabled'
     * ```
     */
    falseLabel: option<Message>(),
  },
});
