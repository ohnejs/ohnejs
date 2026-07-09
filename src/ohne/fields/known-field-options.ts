import type { RecordsOptions } from './relation-options.ts';

/**
 * Call-site option shapes that replace a field type's declared-options mapping wholesale.
 * A member is the complete object `field('<name>', ...)` accepts, common options included.
 * `records` lives here: its `inverse` narrows per the chosen `collection`.
 * Independent per-option declarations cannot express that narrowing.
 * A layer field type augments this the way it augments `KnownFields`.
 */
export interface KnownFieldOptions {
  /**
   * The `records` call-site options: `collection`, `inverse`, and `onDelete`, cross-narrowed.
   */
  records: RecordsOptions;
}
