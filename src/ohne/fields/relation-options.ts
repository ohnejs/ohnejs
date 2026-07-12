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
 * Two shapes, one per side of the relation: declaring `inverse` selects the inverse shape.
 * The inverse side reuses the owning side's junction, so the owner-only options vanish there.
 * Distributes over the known collections, so `inverse` narrows to the chosen target's owning fields.
 * Falls back to plain strings until codegen populates `KnownCollections`.
 */
export type RecordsOptions = [keyof KnownCollections] extends [never]
  ?
      | {
          /**
           * The collection this field relates to, by name.
           */
          collection: string;

          /**
           * Absent here: declaring `inverse` selects the inverse shape instead.
           */
          inverse?: never;

          /**
           * What happens to a link when its target row is deleted.
           * `cascade` removes the link, `restrict` blocks the delete while links exist.
           * Here `cascade` deletes only the link row; on `record` it deletes the referencing row itself.
           *
           * @default
           * 'cascade'
           */
          onDelete?: 'cascade' | 'restrict';

          /**
           * Scopes the junction table by locale, so each content locale holds its own set of links.
           *
           * @default
           * false
           */
          translatable?: boolean;
        }
      | {
          /**
           * The collection this field relates to, by name.
           */
          collection: string;

          /**
           * The owning `records` field on the target collection this field is the inverse of.
           * Both sides then share the owner's junction table, each keeping its own order.
           * Omitted, this field owns the junction itself.
           */
          inverse: string;

          /**
           * Forbidden here: the owning side configures `onDelete`.
           */
          onDelete?: never;

          /**
           * Forbidden here: an inverse field follows the owning side's junction.
           */
          translatable?: never;
        }
  : {
      [C in keyof KnownCollections & string]:
        | {
            /**
             * The collection this field relates to, by name.
             */
            collection: C;

            /**
             * Absent here: declaring `inverse` selects the inverse shape instead.
             */
            inverse?: never;

            /**
             * What happens to a link when its target row is deleted.
             * `cascade` removes the link, `restrict` blocks the delete while links exist.
             * Here `cascade` deletes only the link row; on `record` it deletes the referencing row itself.
             *
             * @default
             * 'cascade'
             */
            onDelete?: 'cascade' | 'restrict';

            /**
             * Scopes the junction table by locale, so each content locale holds its own set of links.
             *
             * @default
             * false
             */
            translatable?: boolean;
          }
        | {
            /**
             * The collection this field relates to, by name.
             */
            collection: C;

            /**
             * The owning `records` field on the target collection this field is the inverse of.
             * Both sides then share the owner's junction table, each keeping its own order.
             * Omitted, this field owns the junction itself.
             */
            inverse: OwningRelationField<C>;

            /**
             * Forbidden here: the owning side configures `onDelete`.
             */
            onDelete?: never;

            /**
             * Forbidden here: an inverse field follows the owning side's junction.
             */
            translatable?: never;
          };
    }[keyof KnownCollections & string];
