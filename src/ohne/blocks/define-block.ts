import type { FieldInstance } from '../fields/field.ts';
import type { Message } from '../messages/known-messages.ts';

import { validateBlockDefinition } from './validate-block.ts';

/**
 * A block definition: the fields one instance of the block carries.
 * The block name is not declared here; it comes from the file under `dirs.blocks`.
 * A block with no fields is legal - a divider or spacer is all type, no data.
 */
export interface BlockDefinition<
  TFields extends Record<string, FieldInstance> = Record<string, FieldInstance>,
> {
  /**
   * A short label for the block, shown where the dashboard names its type.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the block name is sentence-cased: `PricingCard` becomes `Pricing card`.
   *
   * @example
   * ```ts
   * label: 'blocks.hero'                               // a message key, translated
   * label: { key: 'blocks.columns', params: { n: 3 } } // a parameterized message
   * ```
   */
  label?: Message;

  /**
   * The fields, keyed by their camelCase name.
   *
   * @example
   * ```ts
   * fields: {
   *   title: field('text'),
   *   url: field('text', { nullable: true }),
   * }
   * ```
   */
  fields: TFields;
}

/**
 * Any block definition, whatever fields it declares.
 * Registries and codegen hold this widened view, mirroring `AnyCollectionDefinition`.
 */
export interface AnyBlockDefinition {
  /**
   * A short label for the block, shown where the dashboard names its type.
   */
  label?: Message;

  /**
   * The fields, keyed by their camelCase name.
   */
  fields: Record<string, FieldInstance>;
}

/**
 * Defines a block: a reusable content unit a `blocks` field can hold.
 *
 * Default-export the result from a file under a layer's `dirs.blocks`.
 * The file names the block: `blocks/Hero.ts` becomes `Hero`.
 * Its instances share one `block_Hero` table, created once any `blocks` field allows the type.
 * Shared means database-wide: a `unique` field inside a block is unique across every instance.
 *
 * @example
 * ```ts
 * // blocks/Hero.ts
 * import { defineBlock, field } from 'ohnejs'
 *
 * export default defineBlock({
 *   fields: {
 *     title: field('text'),
 *     subtitle: field('text', { nullable: true }),
 *   },
 * })
 * ```
 */
export function defineBlock<TFields extends Record<string, FieldInstance>>(
  definition: BlockDefinition<TFields>,
): BlockDefinition<TFields> {
  validateBlockDefinition(definition);
  return definition;
}
