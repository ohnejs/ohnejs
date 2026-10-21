import type { Amount } from './amount.ts';

/**
 * The values a message's parameters take, by name.
 * A plain `{name}` writes a number with the language's decimal mark and an `Amount` as money.
 *
 * @example
 * ```ts
 * const params: MessageParams = { name: 'Ada', max: 0.5, min: { minor: 500, currency: 'EUR' } }
 * ```
 */
export type MessageParams = Record<string, string | number | Date | Amount>;
