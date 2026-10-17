/**
 * What a highlighted token is, from a closed vocabulary.
 * One theme covers every grammar, a layer's included.
 */
export type HighlightKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'property'
  | 'type'
  | 'function'
  | 'variable'
  | 'tag'
  | 'attribute';

/**
 * A classified span of source code.
 * Offsets index the code the token came from; the text between tokens is plain.
 */
export interface HighlightToken {
  /**
   * What the span is.
   */
  kind: HighlightKind;

  /**
   * Index of the span's first character.
   */
  start: number;

  /**
   * Index one past the span's last character.
   */
  end: number;
}
