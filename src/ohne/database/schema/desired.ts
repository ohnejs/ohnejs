import type { Registry } from '../../../utils/index.ts';
import type { CollectionMeta } from '../../collections/use-collections.ts';
import type { FieldTypeMeta } from '../../fields/use-fields.ts';
import type { ColumnSchema, IndexSchema, TableSchema } from './table-schema.ts';

import { isUndefined } from '../../../utils/index.ts';
import { validateCollectionDefinition } from '../../collections/validate-collection.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { indexName, uniqueName } from '../naming/constraint-names.ts';
import { collectionTableName } from '../naming/table-names.ts';
import { validateCollectionName, validateUniqueNames } from '../naming/validate-names.ts';

/**
 * The `UUID` text primary key, present on every collection main table; users never declare it.
 */
const UUID_COLUMN: ColumnSchema = { name: 'UUID', type: 'text', notNull: true };

/**
 * The internal `_updatedAt` epoch-ms column, present on every collection main table.
 */
const UPDATED_AT_COLUMN: ColumnSchema = { name: '_updatedAt', type: 'integer', notNull: true };

/**
 * Builds the desired schema from the collection and field-type registries.
 *
 * One main table per collection, carrying `UUID`, `_updatedAt`, and one column per column-bearing field.
 * Nullability is `!(nullable || forceNullable)`.
 * An explicit `nullable: false` on a force-nullable field type is rejected, since it cannot take effect.
 * Field-level `unique`/`index` and every `compositeIndexes` entry become constraints on that table.
 * Names funnel through the naming builders, so the diff and introspection agree on them.
 *
 * A field referencing an unregistered type throws, naming the reference and its collection.
 * Column-less field types (`columnType: false`) are the composite and relation kinds.
 * `buildDesiredSchema` throws on them; only column-bearing fields are supported.
 *
 * @example
 * ```ts
 * buildDesiredSchema(useCollections(), useFields())
 * // -> [{ name: 'Posts', columns: [...], ... }]
 * ```
 */
export function buildDesiredSchema(
  collections: Registry<CollectionMeta>,
  fields: Registry<FieldTypeMeta>,
): TableSchema[] {
  const metas = Object.values(collections.all());
  validateUniqueNames(
    metas.map((meta) => meta.name),
    'collection',
  );
  return metas.map((meta) => buildCollectionTable(meta, fields));
}

/**
 * Builds one collection's main table: identity columns first, then its fields and constraints.
 * Constraint names compose from the logical collection name, never from the truncated `table`.
 */
function buildCollectionTable(meta: CollectionMeta, fields: Registry<FieldTypeMeta>): TableSchema {
  validateCollectionName(meta.name);
  validateCollectionDefinition(meta.collection, meta.name);

  const table = collectionTableName(meta.name);
  const columns: ColumnSchema[] = [UUID_COLUMN, UPDATED_AT_COLUMN];
  const uniques: IndexSchema[] = [];
  const indexes: IndexSchema[] = [];

  for (const [name, instance] of Object.entries(meta.collection.fields)) {
    const registered = fields.get(instance.type);
    if (isUndefined(registered)) {
      throw ohneError({
        title: `Unknown field type \`${instance.type}\``,
        body: `Collection \`${meta.name}\` references field type \`${instance.type}\`, which is not registered.`,
      });
    }
    const fieldType = registered.fieldType;
    if (fieldType.columnType === false) {
      throw ohneError({
        title: `Field type \`${instance.type}\` owns no column`,
        body: 'Only column-bearing fields are supported; this field type owns no column.',
      });
    }
    if (instance.options.nullable === false && fieldType.forceNullable === true) {
      throw ohneError({
        title: `Field \`${name}\` cannot be NOT NULL`,
        body: [
          `Its field type \`${instance.type}\` forces the column nullable, so \`nullable: false\` has no effect.`,
          'Drop `nullable: false` from the field.',
        ],
      });
    }
    const notNull = !(instance.options.nullable === true || fieldType.forceNullable === true);
    columns.push({ name, type: fieldType.columnType, notNull });

    if (instance.options.unique === true) {
      uniques.push({ name: uniqueName(meta.name, [name]), columns: [name] });
    } else if (instance.options.index === true || fieldType.index === true) {
      indexes.push({ name: indexName(meta.name, [name]), columns: [name] });
    }
  }

  for (const composite of meta.collection.compositeIndexes ?? []) {
    const target = composite.unique === true ? uniques : indexes;
    const build = composite.unique === true ? uniqueName : indexName;
    target.push({ name: build(meta.name, composite.fields), columns: composite.fields });
  }

  assertDistinctConstraintNames([...uniques, ...indexes], meta.name);
  return { name: table, columns, primaryKey: ['UUID'], uniques, indexes, foreignKeys: [] };
}

/**
 * Rejects two constraints on one table that resolve to the same name.
 * A single-field `compositeIndexes` entry can collide with the field-level `unique`/`index` on that field.
 */
function assertDistinctConstraintNames(
  constraints: readonly IndexSchema[],
  collection: string,
): void {
  const seen = new Set<string>();
  for (const constraint of constraints) {
    const key = constraint.name.toLowerCase();
    if (seen.has(key)) {
      throw ohneError({
        title: `Collection \`${collection}\` builds the constraint \`${constraint.name}\` twice`,
        body: [
          'A field-level `unique`/`index` and a `compositeIndexes` entry produced the same constraint.',
          `Drop one, or change the composite over \`${constraint.columns.join(', ')}\`.`,
        ],
      });
    }
    seen.add(key);
  }
}
