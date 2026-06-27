/**
 * Static metadata for one translatable message, independent of any runtime state.
 * This is what message discovery produces and what codegen serialises.
 */
export interface MessageMeta {
  /**
   * Flat, dot-notation message key.
   * A subdirectory prefixes it, so `dashboard/en.json`'s `save` becomes `dashboard.save`.
   * The first segment is its group.
   */
  key: string;

  /**
   * Canonical BCP-47 language tag the message belongs to, taken from the file's stem.
   * `de-at.json` and `de-AT.json` both resolve to `de-AT`.
   */
  language: string;

  /**
   * The ICU MessageFormat template, the message's value in this language.
   */
  template: string;

  /**
   * Absolute path of the file the message was read from.
   */
  file: string;

  /**
   * Name of the layer that owns the message.
   */
  layer: string;
}
