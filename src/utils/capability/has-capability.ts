import { capabilityCovers } from './capability-covers.ts';

/**
 * Returns whether a set of held capabilities covers a required one.
 * True when any held entry covers it, under the `capabilityCovers` wildcard rules.
 *
 * @example
 * ```ts
 * hasCapability(['blog.posts.*'], 'blog.posts.read') // -> true
 * hasCapability(['*'], 'billing.export')             // -> true
 * hasCapability([], 'blog.posts.read')               // -> false
 * ```
 */
export function hasCapability(held: readonly string[], required: string): boolean {
  return held.some((capability) => capabilityCovers(capability, required));
}
