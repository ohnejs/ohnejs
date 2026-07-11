import type { Registry } from '../../../utils/index.ts';
import type { BlockMeta } from '../../blocks/use-blocks.ts';
import type { CollectionMeta } from '../../collections/use-collections.ts';
import type { FieldType } from '../../fields/define-field.ts';
import type { FieldInstance } from '../../fields/field.ts';
import type {
  BlocksHint,
  ChildHint,
  JunctionHint,
  StorageHint,
} from '../../fields/storage-hint.ts';
import type { FieldTypeMeta } from '../../fields/use-fields.ts';
import type { LogicalType } from '../dialect.ts';
import type {
  ColumnSchema,
  DerivedOrigin,
  ForeignKeySchema,
  IndexSchema,
  TableSchema,
} from './table-schema.ts';

import { createRegistry, isUndefined, naturalCompare } from '../../../utils/index.ts';
import { validateBlockDefinition } from '../../blocks/validate-block.ts';
import { validateCollectionDefinition } from '../../collections/validate-collection.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { resolveFieldOptions } from '../../fields/field.ts';
import { validateField } from '../../fields/validate-field.ts';
import { indexName, uniqueName } from '../naming/constraint-names.ts';
import {
  blockRootName,
  blockTableName,
  collectionTableName,
  derivedTableName,
} from '../naming/table-names.ts';
import {
  validateBlockName,
  validateCollectionName,
  validateFieldName,
  validateUniqueNames,
} from '../naming/validate-names.ts';

/**
 * The registries the desired schema resolves every name reference against.
 */
interface SchemaRegistries {
  collections: Registry<CollectionMeta>;
  fields: Registry<FieldTypeMeta>;
  blocks: Registry<BlockMeta>;
}

/**
 * The definition root a field tree hangs off: a collection, or a block's per-type table.
 */
interface SchemaOwner {
  kind: 'collection' | 'block';
  name: string;
}

/**
 * One field resolved against the registries: its type and materialized storage hint.
 */
interface ResolvedField {
  fieldType: FieldType;
  hint: StorageHint | undefined;
}

/**
 * The table a derived structure hangs off: an owner's root table, or a child table when nesting.
 * `logical` is the untruncated name constraint names compose from; `physical` the foreign-key target.
 * `origin` is absent at the root table and carries the field path below it.
 */
interface DerivedParent {
  owner: SchemaOwner;
  logical: string;
  physical: string;
  origin: DerivedOrigin | undefined;
}

/**
 * Everything one field map contributes to its table, plus the derived tables hanging off it.
 * `columnless` names the fields whose data lives outside the table, for the composite-index guard.
 */
interface FieldMembers {
  columns: ColumnSchema[];
  uniques: IndexSchema[];
  indexes: IndexSchema[];
  foreignKeys: ForeignKeySchema[];
  derived: TableSchema[];
  columnless: Set<string>;
}

/**
 * The `UUID` text primary key, present on every collection, block, child, and wrapper table.
 */
const UUID_COLUMN: ColumnSchema = { name: 'UUID', type: 'text', notNull: true };

/**
 * The internal `_updatedAt` epoch-ms column, present on every collection main table.
 */
const UPDATED_AT_COLUMN: ColumnSchema = { name: '_updatedAt', type: 'integer', notNull: true };

/**
 * Builds the desired schema from the collection, field-type, and block registries.
 *
 * One main table per collection, carrying `UUID`, `_updatedAt`, and one column per column-bearing field.
 * Nullability is `!(nullable || forceNullable)`.
 * A `record` field adds a foreign key on its column, aimed at the target collection's `UUID`.
 * An owning `records` field adds a junction table beside the main one; an `inverse` field adds nothing.
 * An `object` or `repeater` field adds a child table keyed by `UUID`, one or many rows per parent.
 * A `blocks` field adds a wrapper table of ordered, polymorphic block references.
 * Composites nest: each level derives its own child table, emitted depth-first in declaration order.
 * Field-level `unique`/`index` and every `compositeIndexes` entry become constraints on their table.
 * Junction, child, and wrapper tables carry a `DerivedOrigin`, so a collection rename can follow them.
 * Names funnel through the naming builders, so the diff and introspection agree on them.
 *
 * Blocks materialize by reachability: a `block_<Name>` table exists once any wrapper allows the type.
 * A block allowed only inside another block counts as reachable too.
 * Every block table is shared - wrappers reference it, so it is emitted once.
 * Block tables follow the collections, sorted by name.
 * A registered block no wrapper allows stays a type without a table.
 *
 * A field referencing an unregistered type, target collection, or allowed block throws.
 * The error names the reference and the collection or block it appears in.
 * Instance-level rules are validated here, the one place every reference is resolved.
 * They cover common options on column-less fields, `nullable` on force-nullable types, and inverse pairing.
 * Subfield names are validated within each composite's scope.
 *
 * @example
 * ```ts
 * buildDesiredSchema(useCollections(), useFields(), useBlocks())
 * // -> [{ name: 'Posts', columns: [...], ... }, { name: 'Posts_content', ... }, { name: 'block_Hero', ... }]
 * ```
 */
export function buildDesiredSchema(
  collections: Registry<CollectionMeta>,
  fields: Registry<FieldTypeMeta>,
  blocks: Registry<BlockMeta> = createRegistry<BlockMeta>(),
): TableSchema[] {
  const registries: SchemaRegistries = { collections, fields, blocks };
  const metas = Object.values(collections.all());
  validateUniqueNames(
    metas.map((meta) => meta.name),
    'collection',
  );
  validateUniqueNames(
    Object.values(blocks.all()).map((meta) => meta.name),
    'block',
  );
  const reachable = new Set<string>();
  const tables = metas.flatMap((meta) => buildCollectionTables(meta, registries, reachable));
  return [...tables, ...buildReachableBlocks(registries, reachable)];
}

/**
 * Builds one collection's tables: the main table, then its derived tables in declaration order.
 * Constraint names compose from logical names, never from the truncated physical table.
 */
function buildCollectionTables(
  meta: CollectionMeta,
  registries: SchemaRegistries,
  reachable: Set<string>,
): TableSchema[] {
  validateCollectionName(meta.name);
  validateCollectionDefinition(meta.collection, meta.name);

  const parent: DerivedParent = {
    owner: { kind: 'collection', name: meta.name },
    logical: meta.name,
    physical: collectionTableName(meta.name),
    origin: undefined,
  };
  const members = buildFieldMembers(meta.collection.fields, parent, registries, reachable);
  const columns = [UUID_COLUMN, UPDATED_AT_COLUMN, ...members.columns];

  for (const composite of meta.collection.compositeIndexes ?? []) {
    for (const name of composite.fields) {
      if (!members.columnless.has(name)) continue;
      throw ohneError({
        title: `Composite index covers column-less field \`${name}\``,
        body: [
          `A \`compositeIndexes\` entry in collection \`${meta.name}\` lists \`${name}\`, whose data lives outside the main table.`,
          'A constraint cannot span tables; drop the field from the entry.',
        ],
      });
    }
    const target = composite.unique === true ? members.uniques : members.indexes;
    const build = composite.unique === true ? uniqueName : indexName;
    target.push({ name: build(meta.name, composite.fields), columns: composite.fields });
  }

  assertDistinctConstraintNames([...members.uniques, ...members.indexes], meta.name);
  return [
    {
      name: parent.physical,
      columns,
      primaryKey: ['UUID'],
      uniques: members.uniques,
      indexes: members.indexes,
      foreignKeys: members.foreignKeys,
    },
    ...members.derived,
  ];
}

/**
 * Builds the tables of every reachable block: the seeded set, plus what block fields reach in turn.
 * Building a block can reach further blocks, so the closure loops until no new name appears.
 * Emission sorts by block name, so the schema hash never shifts with allow-list order.
 */
function buildReachableBlocks(registries: SchemaRegistries, reachable: Set<string>): TableSchema[] {
  const built = new Map<string, TableSchema[]>();
  let pending = [...reachable];
  while (pending.length > 0) {
    for (const name of pending) {
      const meta = registries.blocks.get(name) as BlockMeta;
      built.set(name, buildBlockTables(meta, registries, reachable));
    }
    pending = [...reachable].filter((name) => !built.has(name));
  }
  return [...built.keys()].sort(naturalCompare).flatMap((name) => built.get(name) as TableSchema[]);
}

/**
 * Builds one block's tables: the shared per-type table, then its derived tables in declaration order.
 * The block's field tree walks the same routing as a collection's, so everything nests inside blocks too.
 */
function buildBlockTables(
  meta: BlockMeta,
  registries: SchemaRegistries,
  reachable: Set<string>,
): TableSchema[] {
  validateBlockName(meta.name);
  validateBlockDefinition(meta.block, meta.name);

  const parent: DerivedParent = {
    owner: { kind: 'block', name: meta.name },
    logical: blockRootName(meta.name),
    physical: blockTableName(meta.name),
    origin: undefined,
  };
  const members = buildFieldMembers(meta.block.fields, parent, registries, reachable);
  return [
    {
      name: parent.physical,
      columns: [UUID_COLUMN, ...members.columns],
      primaryKey: ['UUID'],
      uniques: members.uniques,
      indexes: members.indexes,
      foreignKeys: members.foreignKeys,
      block: meta.name,
    },
    ...members.derived,
  ];
}

/**
 * Walks one field map and assembles what it contributes to its table.
 * The one routing switch: junction, child, and blocks hints derive tables, everything else is a column.
 * `record` foreign keys, field-level `unique`/`index`, and forced indexes attach where the column is.
 */
function buildFieldMembers(
  fieldMap: Record<string, FieldInstance>,
  parent: DerivedParent,
  registries: SchemaRegistries,
  reachable: Set<string>,
): FieldMembers {
  const members: FieldMembers = {
    columns: [],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    derived: [],
    columnless: new Set(),
  };
  for (const [name, instance] of Object.entries(fieldMap)) {
    const label = isUndefined(parent.origin) ? name : `${parent.origin.path.join('.')}.${name}`;
    const { fieldType, hint } = resolveField(parent, name, label, instance, registries);

    if (hint?.kind === 'junction') {
      members.columnless.add(name);
      const junction = buildJunctionTable(parent, name, label, hint, registries);
      if (!isUndefined(junction)) members.derived.push(junction);
      continue;
    }

    if (hint?.kind === 'child') {
      members.columnless.add(name);
      members.derived.push(...buildChildTable(parent, name, label, hint, registries, reachable));
      continue;
    }

    if (hint?.kind === 'blocks') {
      members.columnless.add(name);
      members.derived.push(buildWrapperTable(parent, name, label, hint, registries, reachable));
      continue;
    }

    // `validateField` leaves only junction, child, and blocks hints column-less, so a column type remains.
    const options: Record<string, unknown> = { ...instance.options };
    const notNull = !(options.nullable === true || fieldType.forceNullable === true);
    members.columns.push({ name, type: fieldType.columnType as LogicalType, notNull });

    if (hint?.kind === 'foreignKey') {
      const target = resolveCollection(hint.collection, parent, label, registries);
      members.foreignKeys.push({
        column: name,
        targetTable: collectionTableName(target.name),
        targetColumn: 'UUID',
        onDelete: hint.onDelete ?? 'setNull',
      });
    }

    if (options.unique === true) {
      members.uniques.push({ name: uniqueName(parent.logical, [name]), columns: [name] });
    } else if (options.index === true || fieldType.forceIndex === true) {
      members.indexes.push({ name: indexName(parent.logical, [name]), columns: [name] });
    }
  }
  return members;
}

/**
 * Resolves one field against the field-type registry, materializes its hint, and validates it.
 * `name` is the field's own key; `label` the dotted path from the owner, for the error messages.
 */
function resolveField(
  parent: DerivedParent,
  name: string,
  label: string,
  instance: FieldInstance,
  registries: SchemaRegistries,
): ResolvedField {
  const registered = registries.fields.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: `${ownerSubject(parent.owner)} references field type \`${instance.type}\`, which is not registered.`,
    });
  }
  const fieldType = registered.fieldType;
  const resolved = resolveFieldOptions(fieldType, { ...instance.options });
  const hint = fieldType.schema?.({ name, options: resolved });
  validateField({ owner: ownerLabel(parent.owner), name: label, instance, fieldType, hint });
  return { fieldType, hint };
}

/**
 * Builds the junction table of one owning `records` field, or nothing for an `inverse` field.
 *
 * The junction joins its parent table and the target by `UUID`, each side keeping its own position.
 * `_parentUUID` cascades with its parent; `_targetUUID` follows the hint's `onDelete`.
 * The (`_parentUUID`, `_targetUUID`) unique bars duplicate links and serves parent-side lookups.
 * The `_targetUUID` index serves the inverse direction.
 *
 * A top-level `inverse` field is validated against its owning counterpart and contributes no table.
 * A nested `records` always owns its junction: `inverse` pairs top-level fields, so it is refused.
 * A `records` field in a block owns its junction on the same terms: no collection field can pair with it.
 */
function buildJunctionTable(
  parent: DerivedParent,
  name: string,
  label: string,
  hint: JunctionHint,
  registries: SchemaRegistries,
): TableSchema | undefined {
  const target = resolveCollection(hint.collection, parent, label, registries);
  if (!isUndefined(hint.inverse)) {
    if (parent.owner.kind === 'block') {
      throw ohneError({
        title: `Field \`${label}\` cannot declare \`inverse\``,
        body: [
          'An inverse relation pairs top-level collection fields, so a `records` field in a block always owns its junction.',
          'Drop `inverse`.',
        ],
      });
    }
    if (!isUndefined(parent.origin)) {
      throw ohneError({
        title: `Field \`${label}\` cannot declare \`inverse\``,
        body: [
          'An inverse relation pairs top-level fields, so a nested `records` always owns its junction.',
          'Drop `inverse`.',
        ],
      });
    }
    validateInverse(parent.owner.name, name, hint.inverse, hint, target, registries);
    return undefined;
  }

  const logical = `${parent.logical}_${name}`;
  return {
    name: derivedTableName(parent.logical, name),
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
        targetTable: parent.physical,
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
    derived: originOf(parent, name, 'junction'),
  };
}

/**
 * Builds the child table of one composite field, then recurses into its subfields.
 *
 * The child carries its own `UUID` key and `_parentUUID`, cascading with its parent row.
 * `one` cardinality makes `_parentUUID` unique; `many` adds `_parentPosition` and indexes the parent.
 * Subfields walk the same routing as collection fields, so composites and relations nest freely.
 * Returns the child table first, its own derived tables after, depth-first.
 */
function buildChildTable(
  parent: DerivedParent,
  name: string,
  label: string,
  hint: ChildHint,
  registries: SchemaRegistries,
  reachable: Set<string>,
): TableSchema[] {
  const scope = `${parent.owner.name}.${label}`;
  const subnames = Object.keys(hint.subfields);
  for (const subname of subnames) validateFieldName(subname, scope);
  validateUniqueNames(subnames, 'field', scope);

  const logical = `${parent.logical}_${name}`;
  const origin = originOf(parent, name, hint.cardinality === 'one' ? 'childOne' : 'childMany');
  const next: DerivedParent = {
    owner: parent.owner,
    logical,
    physical: derivedTableName(parent.logical, name),
    origin,
  };
  const members = buildFieldMembers(hint.subfields, next, registries, reachable);

  const columns: ColumnSchema[] = [
    UUID_COLUMN,
    { name: '_parentUUID', type: 'text', notNull: true },
  ];
  if (hint.cardinality === 'many') {
    columns.push({ name: '_parentPosition', type: 'integer', notNull: true });
  }
  columns.push(...members.columns);

  const one = hint.cardinality === 'one';
  const uniques = one
    ? [{ name: uniqueName(logical, ['_parentUUID']), columns: ['_parentUUID'] }, ...members.uniques]
    : members.uniques;
  const indexes = one
    ? members.indexes
    : [{ name: indexName(logical, ['_parentUUID']), columns: ['_parentUUID'] }, ...members.indexes];

  return [
    {
      name: next.physical,
      columns,
      primaryKey: ['UUID'],
      uniques,
      indexes,
      foreignKeys: [
        {
          column: '_parentUUID',
          targetTable: parent.physical,
          targetColumn: 'UUID',
          onDelete: 'cascade',
        },
        ...members.foreignKeys,
      ],
      derived: origin,
    },
    ...members.derived,
  ];
}

/**
 * Builds the wrapper table of one `blocks` field: ordered, polymorphic block references.
 *
 * Each row places one block instance under one parent row.
 * `_blockType` names the per-type table; `_blockUUID` the instance's row in it.
 * The reference is polymorphic on purpose, so no foreign key covers it; the write layer owns cleanup.
 * `_parentUUID` cascades with its parent; both sides of the reference are indexed for lookups and sweeps.
 * The wrapper's `allow` rides its origin, resolved, so the guard can probe live rows against it.
 */
function buildWrapperTable(
  parent: DerivedParent,
  name: string,
  label: string,
  hint: BlocksHint,
  registries: SchemaRegistries,
  reachable: Set<string>,
): TableSchema {
  const allow = resolveAllow(parent, label, hint, registries);
  for (const block of allow) reachable.add(block);

  const logical = `${parent.logical}_${name}`;
  return {
    name: derivedTableName(parent.logical, name),
    columns: [
      UUID_COLUMN,
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_parentPosition', type: 'integer', notNull: true },
      { name: '_blockType', type: 'text', notNull: true },
      { name: '_blockUUID', type: 'text', notNull: true },
    ],
    primaryKey: ['UUID'],
    uniques: [],
    indexes: [
      { name: indexName(logical, ['_parentUUID']), columns: ['_parentUUID'] },
      { name: indexName(logical, ['_blockUUID']), columns: ['_blockUUID'] },
    ],
    foreignKeys: [
      {
        column: '_parentUUID',
        targetTable: parent.physical,
        targetColumn: 'UUID',
        onDelete: 'cascade',
      },
    ],
    derived: { ...originOf(parent, name, 'blocksWrapper'), allow },
  };
}

/**
 * Resolves a wrapper's allowed block types against the block registry.
 * An explicit list is validated name by name; an omitted one means every registered block.
 * The result sorts by name, so the schema hash never shifts with declaration order.
 */
function resolveAllow(
  parent: DerivedParent,
  label: string,
  hint: BlocksHint,
  registries: SchemaRegistries,
): string[] {
  if (isUndefined(hint.allow)) {
    const registered = registries.blocks.keys();
    if (registered.length === 0) {
      throw ohneError({
        title: `Field \`${label}\` has no block types to hold`,
        body: [
          `${ownerSubject(parent.owner)} declares a blocks field, but no block is registered.`,
          'Define one under `dirs.blocks`, or drop the field.',
        ],
      });
    }
    return registered.sort(naturalCompare);
  }
  for (const block of hint.allow) {
    if (registries.blocks.has(block)) continue;
    throw ohneError({
      title: `Unknown block \`${block}\``,
      body: [
        `Field \`${label}\` in ${ownerLabel(parent.owner)} allows block \`${block}\`, which is not registered.`,
      ],
    });
  }
  return [...hint.allow].sort(naturalCompare);
}

/**
 * Validates an `inverse` declaration against the owning field it names on the target collection.
 * Exactly one side owns the junction; the inverse side reuses it with the roles swapped.
 */
function validateInverse(
  collection: string,
  name: string,
  inverse: string,
  hint: JunctionHint,
  target: CollectionMeta,
  registries: SchemaRegistries,
): void {
  const declared = `Field \`${name}\` in collection \`${collection}\` declares \`inverse: '${inverse}'\``;
  if (!isUndefined(hint.onDelete)) {
    throw ohneError({
      title: `Field \`${name}\` cannot set \`onDelete\``,
      body: [
        "An inverse field reuses the owning side's junction, so the owning field configures `onDelete`.",
        'Drop it.',
      ],
    });
  }
  if (target.name === collection && inverse === name) {
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
  const registered = registries.fields.get(owning.type);
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
        `Drop \`inverse\` from \`${target.name}.${inverse}\` or from \`${collection}.${name}\`.`,
      ],
    });
  }
  if (owningHint.collection !== collection) {
    throw ohneError({
      title: `Inverse field \`${inverse}\` points elsewhere`,
      body: [
        `${declared}, but \`${target.name}.${inverse}\` relates to \`${owningHint.collection}\`, not \`${collection}\`.`,
      ],
    });
  }
}

/**
 * Resolves a collection reference by name, or throws naming the reference and where it appears.
 */
function resolveCollection(
  reference: string,
  parent: DerivedParent,
  field: string,
  registries: SchemaRegistries,
): CollectionMeta {
  const meta = registries.collections.get(reference);
  if (isUndefined(meta)) {
    throw ohneError({
      title: `Unknown collection \`${reference}\``,
      body: [
        `Field \`${field}\` in ${ownerLabel(parent.owner)} references collection \`${reference}\`, which is not registered.`,
      ],
    });
  }
  return meta;
}

/**
 * The derivation origin of one field's table: the owner, the extended path, and the storage kind.
 */
function originOf(parent: DerivedParent, name: string, kind: DerivedOrigin['kind']): DerivedOrigin {
  const path: DerivedOrigin['path'] = isUndefined(parent.origin)
    ? [name]
    : [...parent.origin.path, name];
  return parent.owner.kind === 'collection'
    ? { collection: parent.owner.name, path, kind }
    : { block: parent.owner.name, path, kind };
}

/**
 * An owner as the error messages locate a field: 'collection `Posts`' or 'block `Hero`'.
 */
function ownerLabel(owner: SchemaOwner): string {
  return `${owner.kind} \`${owner.name}\``;
}

/**
 * An owner as the error messages open a sentence: 'Collection `Posts`' or 'Block `Hero`'.
 */
function ownerSubject(owner: SchemaOwner): string {
  return owner.kind === 'collection' ? `Collection \`${owner.name}\`` : `Block \`${owner.name}\``;
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
