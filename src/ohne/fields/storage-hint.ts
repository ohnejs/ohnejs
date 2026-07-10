import type { FieldInstance } from './field.ts';

/**
 * The storage layout of a `record` field: a foreign-key column on the owning collection's table.
 * The column holds the target row's `UUID` and is named after the field.
 */
export interface ForeignKeyHint {
  /**
   * Marks the hint as a foreign key.
   */
  kind: 'foreignKey';

  /**
   * The target collection, by name.
   * Resolved against the collection registry when the desired schema builds; an unknown name throws.
   */
  collection: string;

  /**
   * The action taken on referencing rows when their target row is deleted.
   * Omitted means `setNull`, which pairs with the force-nullable column such a field owns.
   */
  onDelete?: 'setNull' | 'cascade' | 'restrict';
}

/**
 * The storage layout of a `records` field: a junction table linking the owner to the target.
 * The junction carries no column on the owner's table; its name joins owner and field with `_`.
 */
export interface JunctionHint {
  /**
   * Marks the hint as a junction.
   */
  kind: 'junction';

  /**
   * The target collection, by name.
   * Resolved against the collection registry when the desired schema builds; an unknown name throws.
   */
  collection: string;

  /**
   * The owning `records` field on the target collection this field is the inverse of.
   * An inverse field creates no table; it reuses the owner's junction with the roles swapped.
   */
  inverse?: string;

  /**
   * The action taken on junction rows when their target row is deleted.
   * Omitted means `cascade`: the link disappears with its target.
   * The parent-side foreign key is always `cascade` and is not configurable.
   */
  onDelete?: 'cascade' | 'restrict';
}

/**
 * The storage layout of an `object` or `repeater` field: a child table beside the owner.
 * The child carries no column on the owner's table; its name joins owner and field with `_`.
 * Each row belongs to one parent row and disappears with it.
 */
export interface ChildHint {
  /**
   * Marks the hint as a child table.
   */
  kind: 'child';

  /**
   * How many child rows a parent row may hold.
   * `one` enforces a single row per parent; `many` orders the rows with a position column.
   */
  cardinality: 'one' | 'many';

  /**
   * The child table's fields, each a regular `field(...)` instance.
   * Composites and relations nest freely; deeper composites derive further child tables.
   */
  subfields: Record<string, FieldInstance>;
}

/**
 * Every storage layout a field type's `schema` can return.
 * The union is closed: new shapes are framework work, not field-type work.
 */
export type StorageHint = ForeignKeyHint | JunctionHint | ChildHint;
