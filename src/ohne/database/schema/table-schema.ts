import type { LogicalType } from '../dialect.ts';

/**
 * The referential action taken on referencing rows when their referenced row is deleted.
 */
export type OnDelete = 'cascade' | 'noAction' | 'restrict' | 'setDefault' | 'setNull';

/**
 * A column of a table, typed by storage primitive.
 */
export interface ColumnSchema {
  /**
   * The column name.
   */
  name: string;

  /**
   * The storage primitive; a dialect maps it to a native column type.
   */
  type: LogicalType;

  /**
   * Whether the column rejects `NULL`.
   */
  notNull: boolean;
}

/**
 * A named column list backing a unique constraint or an index.
 */
export interface IndexSchema {
  /**
   * The constraint or index name.
   */
  name: string;

  /**
   * The covered columns, in defined order.
   */
  columns: readonly string[];
}

/**
 * A foreign key from one column to a referenced table's column.
 * Correlated structurally by `column`; a dialect with unnamed foreign keys, like SQLite, needs no name.
 */
export interface ForeignKeySchema {
  /**
   * The referencing column on the owning table.
   */
  column: string;

  /**
   * The table the foreign key points to.
   */
  targetTable: string;

  /**
   * The referenced column on the target table.
   */
  targetColumn: string;

  /**
   * The action taken on referencing rows when their target row is deleted.
   */
  onDelete: OnDelete;
}

/**
 * Where a derived table comes from: the owner and the field path that declared it.
 * Exactly one of `collection` and `block` names the owner.
 * The snapshot persists it as part of the claim record, since no name is ever parsed back.
 * A collection rename recomputes the table's name from it, so derived tables follow their owner.
 */
export interface DerivedOrigin {
  /**
   * The owning collection's logical name; absent when a block owns the table.
   */
  collection?: string;

  /**
   * The owning block's name; absent when a collection owns the table.
   */
  block?: string;

  /**
   * The field path from the owner to this table, one segment per nesting level.
   */
  path: readonly [string, ...string[]];

  /**
   * The storage shape behind the table.
   * `junction` links the owner to a collection; `childOne` and `childMany` hold composite rows.
   * `blocksWrapper` holds one polymorphic block reference per row.
   */
  kind: 'junction' | 'childOne' | 'childMany' | 'blocksWrapper';

  /**
   * The block types the wrapper may hold, resolved against the block registry; `blocksWrapper` only.
   * The guard probes live rows against it, so a type removal or allow-list shrink never passes silently.
   */
  allow?: readonly string[];
}

/**
 * The normalized shape of one table: columns, primary key, uniques, indexes, and foreign keys.
 */
export interface TableSchema {
  /**
   * The physical table name.
   */
  name: string;

  /**
   * The columns, in defined order.
   */
  columns: readonly ColumnSchema[];

  /**
   * The primary-key columns, in key order; empty for a table without a primary key.
   */
  primaryKey: readonly string[];

  /**
   * The unique constraints.
   */
  uniques: readonly IndexSchema[];

  /**
   * The plain indexes.
   */
  indexes: readonly IndexSchema[];

  /**
   * The foreign keys.
   */
  foreignKeys: readonly ForeignKeySchema[];

  /**
   * The derivation origin of a junction, child, or blocks-wrapper table; absent on root tables.
   * Introspection never reports it: the desired builder sets it and the snapshot preserves it.
   */
  derived?: DerivedOrigin;

  /**
   * The block whose instances this per-type table stores; absent everywhere else.
   * Introspection never reports it: the desired builder sets it and the snapshot preserves it.
   */
  block?: string;
}

/**
 * A column present on both sides whose definition differs.
 */
export interface ColumnChange {
  /**
   * The column as it exists live.
   */
  live: ColumnSchema;

  /**
   * The column as desired.
   */
  desired: ColumnSchema;
}

/**
 * A table to create: desired, with no live counterpart.
 */
export interface TableCreate {
  /**
   * Tags this diff as a create.
   */
  kind: 'create';

  /**
   * The desired table.
   */
  table: TableSchema;
}

/**
 * A live table to drop: no desired counterpart claims its name.
 */
export interface TableDrop {
  /**
   * Tags this diff as a drop.
   */
  kind: 'drop';

  /**
   * The live table.
   */
  table: TableSchema;
}

/**
 * A table present on both sides, every difference listed per column and per constraint.
 */
export interface TableAlter {
  /**
   * Tags this diff as an alter.
   */
  kind: 'alter';

  /**
   * The table as it exists live.
   */
  live: TableSchema;

  /**
   * The table as desired.
   */
  desired: TableSchema;

  /**
   * Columns to add.
   */
  addColumns: readonly ColumnSchema[];

  /**
   * Live columns to drop.
   */
  dropColumns: readonly ColumnSchema[];

  /**
   * Columns whose definition differs between live and desired.
   */
  changeColumns: readonly ColumnChange[];

  /**
   * Whether the primary-key columns differ.
   */
  changePrimaryKey: boolean;

  /**
   * Unique constraints to add.
   */
  addUniques: readonly IndexSchema[];

  /**
   * Live unique constraints to drop.
   */
  dropUniques: readonly IndexSchema[];

  /**
   * Indexes to add.
   */
  addIndexes: readonly IndexSchema[];

  /**
   * Live indexes to drop.
   */
  dropIndexes: readonly IndexSchema[];

  /**
   * Foreign keys to add.
   */
  addForeignKeys: readonly ForeignKeySchema[];

  /**
   * Live foreign keys to drop.
   */
  dropForeignKeys: readonly ForeignKeySchema[];
}

/**
 * One table's difference between the live and the desired schema.
 */
export type TableDiff = TableCreate | TableDrop | TableAlter;
