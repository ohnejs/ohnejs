import { capabilityCovers } from './capability-covers.ts';

/**
 * Returns whether a set of held capabilities covers a required one.
 * True when any held entry covers it, under the `capabilityCovers` wildcard rules.
 *
 * @example
 * ```ts
 * hasCapability(['collection.Posts.*'], 'collection.Posts.read') // -> true
 * hasCapability(['*'], 'billing.export')                         // -> true
 * hasCapability([], 'collection.Posts.read')                     // -> false
 * ```
 */
export function hasCapability(held: readonly string[], required: string): boolean {
  return held.some((capability) => capabilityCovers(capability, required));
}
