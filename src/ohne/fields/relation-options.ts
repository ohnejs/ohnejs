import type { KnownCollections } from '../collections/known-collections.ts';
import type { KnownRelations } from '../collections/known-relations.ts';

/**
 * The owning `records` fields of collection `C`: the legal `inverse` targets.
 * Resolves to `never` when `C` owns no `records` field - there is nothing to pair with.
 * Guarded on membership, so the type stays sound when `KnownRelations` lacks a member for `C`.
 */
export type OwningRelationField<C extends string> = C extends keyof KnownRelations
  ? keyof KnownRelations[C] & string
  : never;

/**
 * The options `field('records', ...)` accepts.
 * Distributes over the known collections, so `inverse` narrows to the chosen target's owning fields.
 * Falls back to plain strings until codegen populates `KnownCollections`.
 */
export type RecordsOptions = [keyof KnownCollections] extends [never]
  ? {
      /**
       * The collection this field relates to, by name.
       */
      collection: string;

      /**
       * The owning `records` field on the target collection this field is the inverse of.
       * Both sides then share the owner's junction table, each keeping its own order.
       * Omitted, this field owns the junction itself.
       */
      inverse?: string;

      /**
       * What happens to a link when its target row is deleted.
       * `cascade` removes the link, `restrict` blocks the delete while links exist.
       * Only the owning side configures this; an `inverse` field cannot.
       *
       * @default
       * 'cascade'
       */
      onDelete?: 'cascade' | 'restrict';
    }
  : {
      [C in keyof KnownCollections & string]: {
        /**
         * The collection this field relates to, by name.
         */
        collection: C;

        /**
         * The owning `records` field on the target collection this field is the inverse of.
         * Both sides then share the owner's junction table, each keeping its own order.
         * Omitted, this field owns the junction itself.
         */
        inverse?: OwningRelationField<C>;

        /**
         * What happens to a link when its target row is deleted.
         * `cascade` removes the link, `restrict` blocks the delete while links exist.
         * Only the owning side configures this; an `inverse` field cannot.
         *
         * @default
         * 'cascade'
         */
        onDelete?: 'cascade' | 'restrict';
      };
    }[keyof KnownCollections & string];
