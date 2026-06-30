import { stripTypeScriptTypes } from 'node:module';

/**
 * Spend `stripTypeScriptTypes`'s one-time experimental warning up front, with warnings muted.
 * Node dedupes it per process, so later strips stay silent and every other warning still reaches the user.
 *
 * @example
 * ```ts
 * silenceFirstStripWarning()                  // -> consumes the warning
 * stripTypeScriptTypes('const x: number = 1') // -> no warning emitted
 * ```
 */
export function silenceFirstStripWarning() {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  stripTypeScriptTypes('');
  process.emitWarning = emitWarning;
}
