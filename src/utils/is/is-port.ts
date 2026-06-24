import { isInteger } from './is-integer.ts';

/**
 * Largest valid TCP/UDP port number.
 */
export const MAX_PORT = 65535;

/**
 * Checks whether a value is a usable port: an integer in `[0, MAX_PORT]`.
 * Port `0` is valid - it asks the OS for an ephemeral port.
 *
 * @example
 * ```ts
 * isPort(3000)   // -> true
 * isPort(0)      // -> true
 * isPort(70000)  // -> false
 * isPort(3000.5) // -> false
 * isPort(-1)     // -> false
 * ```
 */
export function isPort(value: unknown): value is number {
  return isInteger(value) && value >= 0 && value <= MAX_PORT;
}
