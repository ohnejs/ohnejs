import type { LiteralUnion } from '../../utils/types/literal-union.ts';
import type { MessageKey } from './known-messages.ts';

/**
 * Text a component shows: a message key, plain text, a `{ key, params }` pair, or a getter.
 * Editors suggest every known message key; any other string renders as itself.
 * A getter computes the text, so it can read refs and stay live.
 *
 * @example
 * ```ts
 * const title: Text = 'dashboard.overview.title'
 * const plain: Text = 'Revenue'
 * const counted: Text = { key: 'dashboard.foundErrors', params: { count: 2 } }
 * const live: Text = () => `${count.value} selected`
 * ```
 */
export type Text =
  | LiteralUnion<MessageKey>
  | {
      /**
       * The message key.
       */
      key: LiteralUnion<MessageKey>;

      /**
       * The values the key's template interpolates.
       */
      params?: Record<string, unknown>;
    }
  | (() => string);
