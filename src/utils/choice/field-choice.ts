import type { MessageData } from '../i18n/message-data.ts';

/**
 * A choice value paired with its display label.
 * `TLabel` is the label type: a message on the server, a live text in the browser.
 *
 * @example
 * ```ts
 * const live: LabeledChoice = { value: 'live', label: 'app.posts.published' }
 * ```
 */
export interface LabeledChoice<TLabel = MessageData> {
  /**
   * The stored value.
   */
  value: string;

  /**
   * The label the dashboard shows for the value.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   */
  label: TLabel;
}

/**
 * One choice a `select` or `multiSelect` field admits.
 * A plain string is both the stored value and its display text.
 * The object form pairs the stored value with a translatable display label.
 *
 * @example
 * ```ts
 * const choices: FieldChoice[] = ['draft', { value: 'live', label: 'Published' }]
 * ```
 */
export type FieldChoice<TLabel = MessageData> = string | LabeledChoice<TLabel>;
