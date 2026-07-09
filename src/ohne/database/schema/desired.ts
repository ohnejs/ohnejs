import type { Registry } from '../../../utils/index.ts';
import type { CollectionMeta } from '../../collections/use-collections.ts';
import type { FieldType } from '../../fields/define-field.ts';
import type { FieldInstance } from '../../fields/field.ts';
import type { JunctionHint, StorageHint } from '../../fields/storage-hint.ts';
import type { FieldTypeMeta } from '../../fields/use-fields.ts';
import type { LogicalType } from '../dialect.ts';
import type { ColumnSchema, ForeignKeySchema, IndexSchema, TableSchema } from './table-schema.ts';

import { isUndefined } from '../../../utils/index.ts';
import { validateCollectionDefinition } from '../../collections/validate-collection.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { resolveFieldOptions } from '../../fields/field.ts';
import { validateField } from '../../fields/validate-field.ts';
import { indexName, uniqueName } from '../naming/constraint-names.ts';
import { collectionTableName, derivedTableName } from '../naming/table-names.ts';
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
 * One field resolved against the registries: its type and materialized storage hint.
 */
interface ResolvedField {
  fieldType: FieldType;
  hint: StorageHint | undefined;
}

/**
 * Builds the desired schema from the collection and field-type registries.
 *
 * One main table per collection, carrying `UUID`, `_updatedAt`, and one column per column-bearing field.
 * Nullability is `!(nullable || forceNullable)`.
 * A `record` field adds a foreign key on its column, aimed at the target collection's `UUID`.
 * An owning `records` field adds a junction table beside the main one; an `inverse` field adds nothing.
 * Field-level `unique`/`index` and every `compositeIndexes` entry become constraints on the main table.
 * Names funnel through the naming builders, so the diff and introspection agree on them.
 *
 * A field referencing an unregistered type or an unknown target collection throws.
 * The error names the reference and the collection it appears in.
 * Instance-level rules are validated here, the one place every reference is resolved.
 * They cover common options on column-less fields, `nullable` on force-nullable types, and inverse pairing.
 *
 * @example
 * ```ts
 * buildDesiredSchema(useCollections(), useFields())
 * // -> [{ name: 'Posts', columns: [...], ... }, { name: 'Posts_authors', ... }]
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
  return metas.flatMap((meta) => buildCollectionTables(meta, collections, fields));
}

/**
 * Builds one collection's tables: the main table, then one junction per owning `records` field.
 * Constraint names compose from logical names, never from the truncated physical table.
 */
function buildCollectionTables(
  meta: CollectionMeta,
  collections: Registry<CollectionMeta>,
  fields: Registry<FieldTypeMeta>,
): TableSchema[] {
  validateCollectionName(meta.name);
  validateCollectionDefinition(meta.collection, meta.name);

  const table = collectionTableName(meta.name);
  const junctions: TableSchema[] = [];
  const columnless = new Set<string>();
  const columns: ColumnSchema[] = [UUID_COLUMN, UPDATED_AT_COLUMN];
  const uniques: IndexSchema[] = [];
  const indexes: IndexSchema[] = [];
  const foreignKeys: ForeignKeySchema[] = [];

  for (const [name, instance] of Object.entries(meta.collection.fields)) {
    const { fieldType, hint } = resolveField(meta, name, instance, fields);

    if (hint?.kind === 'junction') {
      columnless.add(name);
      const junction = buildJunctionTable(meta, name, hint, collections, fields);
      if (!isUndefined(junction)) junctions.push(junction);
      continue;
    }

    // `validateField` leaves only junction hints column-less, so a column type remains here.
    const options: Record<string, unknown> = { ...instance.options };
    const notNull = !(options.nullable === true || fieldType.forceNullable === true);
    columns.push({ name, type: fieldType.columnType as LogicalType, notNull });

    if (hint?.kind === 'foreignKey') {
      const target = resolveCollection(hint.collection, meta.name, name, collections);
      foreignKeys.push({
        column: name,
        targetTable: collectionTableName(target.name),
        targetColumn: 'UUID',
        onDelete: hint.onDelete ?? 'setNull',
      });
    }

    if (options.unique === true) {
      uniques.push({ name: uniqueName(meta.name, [name]), columns: [name] });
    } else if (options.index === true || fieldType.forceIndex === true) {
      indexes.push({ name: indexName(meta.name, [name]), columns: [name] });
    }
  }

  for (const composite of meta.collection.compositeIndexes ?? []) {
    for (const name of composite.fields) {
      if (!columnless.has(name)) continue;
      throw ohneError({
        title: `Composite index covers column-less field \`${name}\``,
        body: [
          `A \`compositeIndexes\` entry in collection \`${meta.name}\` lists \`${name}\`, whose data lives outside the main table.`,
          'A constraint cannot span tables; drop the field from the entry.',
        ],
      });
    }
    const target = composite.unique === true ? uniques : indexes;
    const build = composite.unique === true ? uniqueName : indexName;
    target.push({ name: build(meta.name, composite.fields), columns: composite.fields });
  }

  assertDistinctConstraintNames([...uniques, ...indexes], meta.name);
  return [
    { name: table, columns, primaryKey: ['UUID'], uniques, indexes, foreignKeys },
    ...junctions,
  ];
}

/**
 * Resolves one field against the field-type registry, materializes its hint, and validates it.
 */
function resolveField(
  meta: CollectionMeta,
  name: string,
  instance: FieldInstance,
  fields: Registry<FieldTypeMeta>,
): ResolvedField {
  const registered = fields.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: `Collection \`${meta.name}\` references field type \`${instance.type}\`, which is not registered.`,
    });
  }
  const fieldType = registered.fieldType;
  const resolved = resolveFieldOptions(fieldType, { ...instance.options });
  const hint = fieldType.schema?.({ name, options: resolved });
  validateField({ collection: meta.name, name, instance, fieldType, hint });
  return { fieldType, hint };
}

/**
 * Builds the junction table of one owning `records` field, or nothing for an `inverse` field.
 *
 * The junction joins owner and target by `UUID`, and each side keeps its own position column.
 * `_parentUUID` cascades with its owner; `_targetUUID` follows the hint's `onDelete`.
 * The (`_parentUUID`, `_targetUUID`) unique bars duplicate links and serves parent-side lookups.
 * The `_targetUUID` index serves the inverse direction.
 *
 * An `inverse` field is validated against its owning counterpart and contributes no table.
 */
function buildJunctionTable(
  meta: CollectionMeta,
  name: string,
  hint: JunctionHint,
  collections: Registry<CollectionMeta>,
  fields: Registry<FieldTypeMeta>,
): TableSchema | undefined {
  const target = resolveCollection(hint.collection, meta.name, name, collections);
  if (!isUndefined(hint.inverse)) {
    validateInverse(meta, name, hint.inverse, hint, target, fields);
    return undefined;
  }

  const logical = `${meta.name}_${name}`;
  return {
    name: derivedTableName(meta.name, name),
    columns: [
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_targetUUID', type: 'text', notNull: true },
      { name: '_parentPosition', type: 'integer', notNull: true },
      { name: '_targetPosition', type: 'integer', notNull: true },
    ],
    primaryKey: [],
    uniques: [
      {
        name: uniqueName(logical, ['_parentUUID', '_targetUUID']),
        columns: ['_parentUUID', '_targetUUID'],
      },
    ],
    indexes: [{ name: indexName(logical, ['_targetUUID']), columns: ['_targetUUID'] }],
    foreignKeys: [
      {
        column: '_parentUUID',
        targetTable: collectionTableName(meta.name),
        targetColumn: 'UUID',
        onDelete: 'cascade',
      },
      {
        column: '_targetUUID',
        targetTable: collectionTableName(target.name),
        targetColumn: 'UUID',
        onDelete: hint.onDelete ?? 'cascade',
      },
    ],
  };
}

/**
 * Validates an `inverse` declaration against the owning field it names on the target collection.
 * Exactly one side owns the junction; the inverse side reuses it with the roles swapped.
 */
function validateInverse(
  meta: CollectionMeta,
  name: string,
  inverse: string,
  hint: JunctionHint,
  target: CollectionMeta,
  fields: Registry<FieldTypeMeta>,
): void {
  const declared = `Field \`${name}\` in collection \`${meta.name}\` declares \`inverse: '${inverse}'\``;
  if (!isUndefined(hint.onDelete)) {
    throw ohneError({
      title: `Field \`${name}\` cannot set \`onDelete\``,
      body: [
        "An inverse field reuses the owning side's junction, so the owning field configures `onDelete`.",
        'Drop it.',
      ],
    });
  }
  if (target.name === meta.name && inverse === name) {
    throw ohneError({
      title: `Field \`${name}\` declares itself as its inverse`,
      body: [
        'A field cannot pair with itself; exactly one side owns the junction and the other mirrors it.',
        'Drop `inverse` for a directed self-relation, or pair it with a second `records` field.',
      ],
    });
  }
  const owning = target.collection.fields[inverse];
  if (isUndefined(owning)) {
    throw ohneError({
      title: `Unknown inverse field \`${inverse}\``,
      body: [`${declared}, but collection \`${target.name}\` has no field \`${inverse}\`.`],
    });
  }
  const registered = fields.get(owning.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${owning.type}\``,
      body: `Collection \`${target.name}\` references field type \`${owning.type}\`, which is not registered.`,
    });
  }
  const resolved = resolveFieldOptions(registered.fieldType, { ...owning.options });
  const owningHint = registered.fieldType.schema?.({ name: inverse, options: resolved });
  if (owningHint?.kind !== 'junction') {
    throw ohneError({
      title: `Field \`${inverse}\` cannot be an inverse target`,
      body: [`${declared}, but \`${target.name}.${inverse}\` owns no junction.`],
    });
  }
  if (!isUndefined(owningHint.inverse)) {
    throw ohneError({
      title: `Fields \`${name}\` and \`${inverse}\` both declare \`inverse\``,
      body: [
        'Exactly one side of a relation owns the junction; the other declares `inverse`.',
        `Drop \`inverse\` from \`${target.name}.${inverse}\` or from \`${meta.name}.${name}\`.`,
      ],
    });
  }
  if (owningHint.collection !== meta.name) {
    throw ohneError({
      title: `Inverse field \`${inverse}\` points elsewhere`,
      body: [
        `${declared}, but \`${target.name}.${inverse}\` relates to \`${owningHint.collection}\`, not \`${meta.name}\`.`,
      ],
    });
  }
}

/**
 * Resolves a collection reference by name, or throws naming the reference and where it appears.
 */
function resolveCollection(
  reference: string,
  owner: string,
  field: string,
  collections: Registry<CollectionMeta>,
): CollectionMeta {
  const meta = collections.get(reference);
  if (isUndefined(meta)) {
    throw ohneError({
      title: `Unknown collection \`${reference}\``,
      body: [
        `Field \`${field}\` in collection \`${owner}\` references collection \`${reference}\`, which is not registered.`,
      ],
    });
  }
  return meta;
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
