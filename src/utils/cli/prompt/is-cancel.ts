/**
 * Sentinel a prompt resolves to when the user cancels with `ctrl+c`.
 */
export const CANCEL: unique symbol = Symbol('ohne.prompt.cancel');

/**
 * The outcome of a prompt: the chosen value, or `CANCEL` when the user cancelled.
 */
export type PromptResult<T> = T | typeof CANCEL;

/**
 * Checks whether a prompt result is the `CANCEL` sentinel.
 * In the `false` branch the value narrows back to the prompt's own type.
 *
 * @example
 * ```ts
 * const name = await prompt.text({ message: 'Name?' })
 * if (isCancel(name)) return // name is CANCEL here
 * name.toUpperCase()         // name is string here
 * ```
 */
export function isCancel(value: unknown): value is typeof CANCEL {
  return value === CANCEL;
}
