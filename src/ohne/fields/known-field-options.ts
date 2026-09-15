import type { FieldOptions } from './field.ts';
import type { RecordsOptions } from './relation-options.ts';

/**
 * Call-site option shapes that replace a field type's declared-options mapping wholesale.
 * A member replaces the declared and common options; the value and presentation options still join.
 * `records` lives here: its `inverse` narrows per the chosen `collection`.
 * Independent per-option declarations cannot express that narrowing.
 * A layer field type augments this by hand, with `declare module 'ohnejs'`.
 */
export interface KnownFieldOptions {
  /**
   * The `records` call-site options: `collection`, `inverse`, and `onDelete`, cross-narrowed.
   * The visibility flags every kind carries join them.
   */
  records: RecordsOptions & Pick<FieldOptions, 'readable' | 'writable' | 'immutable'>;
}
