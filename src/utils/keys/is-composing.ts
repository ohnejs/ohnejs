/**
 * The subset of a browser `KeyboardEvent` that tells whether an input method owns the key.
 */
export interface ComposingEventLike {
  /**
   * Whether the key falls inside an input method's composition.
   */
  isComposing: boolean;

  /**
   * The legacy key code; `229` marks a key an input method took.
   */
  keyCode: number;
}

/**
 * Whether a keydown belongs to an input method composing text, as with Japanese or Chinese input.
 * Enter there confirms the candidate, so a handler must leave the key alone.
 * Safari fires the confirming keydown after `compositionend` with `isComposing` unset, so `229` counts too.
 *
 * @example
 * ```ts
 * isComposing({ isComposing: true, keyCode: 13 })   // -> true
 * isComposing({ isComposing: false, keyCode: 229 }) // -> true
 * isComposing({ isComposing: false, keyCode: 13 })  // -> false
 * ```
 */
export function isComposing(event: ComposingEventLike): boolean {
  return event.isComposing || event.keyCode === 229;
}
