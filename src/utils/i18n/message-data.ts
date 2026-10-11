/**
 * A message as plain data, the shape it keeps on the wire.
 * A string is a message key, or plain text when no catalog defines it.
 * An object is a `{ key, params }` pair, its `params` the values the key's template interpolates.
 *
 * @example
 * ```ts
 * const label: MessageData = 'dashboard.overview.title'
 * const count: MessageData = { key: 'dashboard.foundErrors', params: { count: 2 } }
 * ```
 */
export type MessageData =
  | string
  | {
      /**
       * The message key.
       */
      key: string;

      /**
       * The values the key's template interpolates.
       */
      params?: Record<string, unknown>;
    };
