import type { SchemaClassification } from '../schema/snapshot.ts';
import type { DerivedOrigin, TableSchema } from '../schema/table-schema.ts';
import type {
  ColumnAddress,
  DiscardAddress,
  DiscardMigration,
  MigrationTransform,
  MoveMigration,
  RenameMigration,
  TableAddress,
} from './define-migration.ts';
import type { MigrationMeta } from './use-migrations.ts';

import { isNull, isObject, isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { collectionTableName, derivedTableName } from '../naming/table-names.ts';
import { RESERVED_COLLECTIONS } from '../naming/validate-names.ts';

/**
 * The logical subtree an address covers: a collection and the field path below it.
 * An empty path covers the whole collection, derived tables included.
 */
export interface LogicalSubtree {
  /**
   * The collection's logical name.
   */
  collection: string;

  /**
   * The field path below the collection; empty for the collection itself.
   */
  path: readonly string[];
}

/**
 * One table a migration's `from` consumes, computed purely from the address, no live schema needed.
 * An ambiguous logical `from` lists both of its readings; over-approximation is safe for satisfaction.
 */
export interface ConsumedAddress {
  /**
   * The physical table name.
   */
  table: string;

  /**
   * The column name; absent when the whole table is consumed.
   */
  column?: string;

  /**
   * The logical subtree a table-grain logical `from` consumes, its derived family included.
   * A compound enumerates its family only at run time, so satisfaction matches on this instead:
   * a logical `to` under the subtree counts as consumed even where no physical name can line up.
   */
  subtree?: LogicalSubtree;
}

/**
 * One member of a compound rename: a physical pair plus the claim origin the rename installs.
 */
export interface RenameMember {
  /**
   * The physical table as it exists live.
   */
  from: string;

  /**
   * The physical table name after the rename.
   */
  to: string;

  /**
   * The derivation origin the renamed table's claim takes; absent on a collection main table.
   */
  origin?: DerivedOrigin;
}

/**
 * A migration lowered to physical form: one of the four single ops, or a compound's member list.
 */
export type LoweredMigration =
  | {
      kind: 'move';
      from: ColumnAddress;
      to: ColumnAddress;
      toSubtree?: LogicalSubtree;
      transform?: MigrationTransform;
    }
  | { kind: 'rename'; from: TableAddress; to: TableAddress }
  | { kind: 'discardColumn'; from: ColumnAddress }
  | { kind: 'discardTable'; from: TableAddress }
  | { kind: 'compoundRename'; members: readonly RenameMember[]; to: LogicalSubtree }
  | { kind: 'compoundDiscard'; tables: readonly string[] };

/**
 * The live and desired state a logical address lowers against, just in time in the executor loop.
 */
export interface ResolveState {
  /**
   * The live table names, tracked through the run's own changes.
   */
  names: ReadonlySet<string>;

  /**
   * The claim record, tracked through the run's own changes.
   */
  claimed: SchemaClassification;

  /**
   * The tables the running code wants live.
   */
  desired: readonly TableSchema[];

  /**
   * Whether the snapshot recorded derivation ownership on its claims.
   * Without it, a rename verifies its family through the `to` tree and a table discard refuses.
   */
  ownership: boolean;

  /**
   * Describes one live table, logical types restored.
   */
  describe(table: string): Promise<TableSchema>;
}

/**
 * A logical address in its loosest runtime shape, the union every form's address satisfies.
 */
type LogicalAddress = DiscardAddress;

/**
 * A physical address in its loosest runtime shape.
 */
type PhysicalAddress = ColumnAddress | TableAddress;

/**
 * An address of any form and either spelling, as the resolver receives it.
 */
type AnyAddress = MoveMigration['from'] | RenameMigration['from'] | DiscardMigration['from'];

/**
 * The physical readings of one address: the tables it may name, purely from the address itself.
 * An ambiguous logical address lists both readings; over-approximation is safe for both callers.
 */
function readingsOf(meta: MigrationMeta, address: AnyAddress): ConsumedAddress[] {
  if (!('collection' in address)) {
    return 'column' in address
      ? [{ table: address.table, column: address.column }]
      : [{ table: address.table }];
  }
  const logical = address as LogicalAddress;
  const collection = logicalCollection(meta, logical);
  if (isUndefined(logical.field)) {
    return [{ table: collectionTableName(collection), subtree: { collection, path: [] } }];
  }
  const segments = fieldSegments(meta, logical.field);
  const column = columnReading(collection, segments);
  return [
    { table: column.table, column: column.column },
    { table: tableReading(collection, segments), subtree: { collection, path: segments } },
  ];
}

/**
 * The migration's `from` address, shape-checked: a missing or non-object `from` refuses by name.
 */
function fromAddress(meta: MigrationMeta): AnyAddress {
  const from = (meta.migration as { from?: unknown }).from;
  if (isObject(from)) return from as unknown as AnyAddress;
  throw ohneError({
    title: `Migration \`${meta.name}\` has no \`from\``,
    body: [
      '`from` names what the migration reads: a `collection` and `field`, or a `table` and `column`.',
    ],
    path: meta.file,
  });
}

/**
 * The migration's `to` address, shape-checked: `null` marks a discard; anything else is an address.
 */
function toAddress(meta: MigrationMeta): AnyAddress | null {
  const to = (meta.migration as { to?: unknown }).to;
  if (isNull(to)) return null;
  if (isObject(to)) return to as unknown as AnyAddress;
  throw ohneError({
    title: `Migration \`${meta.name}\` has no \`to\``,
    body: ['A move or rename sets `to` to the new address; a discard sets `to: null` on purpose.'],
    path: meta.file,
  });
}

/**
 * The tables a migration's `from` consumes, for `to`-satisfaction of the migrations before it.
 * Pure over the address: physical names never need the live schema, so chains skip end to end.
 */
export function consumedByMigration(meta: MigrationMeta): ConsumedAddress[] {
  return readingsOf(meta, fromAddress(meta));
}

/**
 * The physical tables a migration may touch, for the sync's constraint bracket.
 * Pure over the addresses; an ambiguous logical address contributes both of its readings.
 */
export function touchedByMigration(meta: MigrationMeta): string[] {
  const tables = consumedByMigration(meta).map((consumed) => consumed.table);
  const to = toAddress(meta);
  if (isNull(to)) return tables;
  return [...tables, ...readingsOf(meta, to).map((consumed) => consumed.table)];
}

/**
 * Lowers one migration to physical form against the live and desired state, just in time.
 *
 * Physical addresses pass through; logical ones resolve through the naming builders.
 * A logical pair reads as a move over a live column, as a rename over a live derived table.
 * `transform` or a `type` pin selects the column reading; both readings live at once refuses.
 * With no live evidence the `to` side decides, so fresh databases skip chains end to end.
 * A collection-level rename or discard lowers to its family of member tables, claims-enumerated.
 * A pre-ownership snapshot bootstraps a rename's family from the `to` tree.
 * Table-grain discards refuse there, since nothing records what they cover.
 */
export async function lowerMigration(
  state: ResolveState,
  meta: MigrationMeta,
): Promise<LoweredMigration> {
  const { migration } = meta;
  const from = fromAddress(meta);
  const to = toAddress(meta);
  const fromLogical = 'collection' in from;
  const transform = 'transform' in migration ? migration.transform : undefined;
  if (isNull(to)) {
    if (!isUndefined(transform)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pairs a transform with a discard`,
        body: [
          'A transform rides a move; a discard only drops.',
          'Drop the transform, or make the migration a move.',
        ],
        path: meta.file,
      });
    }
    if (!fromLogical) {
      const physical = from as PhysicalAddress;
      assertPurelyPhysical(meta, physical);
      return 'column' in physical
        ? { kind: 'discardColumn', from: physical }
        : { kind: 'discardTable', from: physical };
    }
    assertPurelyLogical(meta, from as LogicalAddress);
    return lowerDiscard(state, meta, from as LogicalAddress);
  }
  const toLogical = 'collection' in to;
  if (fromLogical !== toLogical) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes a logical and a physical address`,
      body: [
        'A logical `collection` address pairs with a logical one; a physical `table` with a physical one.',
        'Give `from` and `to` the same form.',
      ],
      path: meta.file,
    });
  }
  if (!fromLogical || !toLogical) {
    return lowerPhysicalPair(meta, from as PhysicalAddress, to as PhysicalAddress, transform);
  }
  assertPurelyLogical(meta, from as LogicalAddress);
  assertPurelyLogical(meta, to as LogicalAddress);
  return lowerLogicalPair(state, meta, from as LogicalAddress, to as LogicalAddress, transform);
}

/**
 * Normalizes a physical pair into a move or a rename.
 * A `ColumnAddress` satisfies `TableAddress` structurally, so a mixed pair typechecks; refuse it here.
 */
function lowerPhysicalPair(
  meta: MigrationMeta,
  from: PhysicalAddress,
  to: PhysicalAddress,
  transform: MigrationTransform | undefined,
): LoweredMigration {
  assertPurelyPhysical(meta, from);
  assertPurelyPhysical(meta, to);
  const fromColumn = 'column' in from;
  const toColumn = 'column' in to;
  if (fromColumn !== toColumn) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes a column and a table address`,
      body: [
        'A move addresses two columns; a rename addresses two tables.',
        'Give `from` and `to` the same shape.',
      ],
      path: meta.file,
    });
  }
  if (fromColumn) {
    return { kind: 'move', from, to: to as ColumnAddress, transform };
  }
  if (!isUndefined(transform)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` transforms without a column`,
      body: [
        'A transform rides a move, and a move addresses two columns.',
        'Address the columns, or drop the transform.',
      ],
      path: meta.file,
    });
  }
  if (from.table === to.table) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames \`${from.table}\` onto itself`,
      body: ['Point `to` at the new table name, or delete the migration.'],
      path: meta.file,
    });
  }
  return { kind: 'rename', from, to: to as TableAddress };
}

/**
 * Refuses a physical address carrying logical keys, a stray `type`, or a column missing its type.
 * The `ohne_` namespace refuses too: those tables carry framework state, never user data.
 * A mistyped address must never silently read as something else.
 */
function assertPurelyPhysical(meta: MigrationMeta, address: PhysicalAddress): void {
  if (address.table.startsWith('ohne_')) {
    throw ohneError({
      title: `Migration \`${meta.name}\` targets ohne's internal \`${address.table}\``,
      body: [
        "Tables under the `ohne_` prefix carry the framework's own state, never user data.",
        'Fix the migration address.',
      ],
      path: meta.file,
    });
  }
  if ('field' in address) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes address spellings`,
      body: [
        'An address is logical (`collection`, `field`) or physical (`table`, `column`), never both.',
        'Drop one spelling.',
      ],
      path: meta.file,
    });
  }
  if ('column' in address) {
    if (!isUndefined(address.type)) return;
    throw ohneError({
      title: `Migration \`${meta.name}\` addresses a column without its \`type\``,
      body: [
        'A physical column address pins the `type` it expects live.',
        'Set it, or use the logical `collection` and `field` spelling, which resolves types for you.',
      ],
      path: meta.file,
    });
  }
  if ('type' in address && !isUndefined((address as { type?: unknown }).type)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` pins a \`type\` without a column`,
      body: ['A table address names no column to type.', 'Name the `column`, or drop `type`.'],
      path: meta.file,
    });
  }
}

/**
 * Lowers a logical pair: resolves the reading, then builds the move or the rename compound.
 */
async function lowerLogicalPair(
  state: ResolveState,
  meta: MigrationMeta,
  from: LogicalAddress,
  to: LogicalAddress,
  transform: MigrationTransform | undefined,
): Promise<LoweredMigration> {
  const fromCollection = logicalCollection(meta, from);
  const toCollection = logicalCollection(meta, to);

  if (isUndefined(from.field) !== isUndefined(to.field)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` pairs a collection with a field`,
      body: [
        'A collection renames onto a collection; a field moves or renames onto a field.',
        'Give `from` and `to` the same shape.',
      ],
      path: meta.file,
    });
  }

  if (isUndefined(from.field) || isUndefined(to.field)) {
    if (!isUndefined(transform)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` transforms without a column`,
        body: [
          'A transform rides a move, and a move needs `field` naming the column.',
          'Name the field, or drop the transform.',
        ],
        path: meta.file,
      });
    }
    if (!isUndefined(from.type) || !isUndefined(to.type)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pins a \`type\` without a field`,
        body: ['A collection rename names no column.', 'Name the field, or drop `type`.'],
        path: meta.file,
      });
    }
    if (fromCollection === toCollection) {
      throw ohneError({
        title: `Migration \`${meta.name}\` renames \`${fromCollection}\` onto itself`,
        body: ['Point `to` at the new collection name, or delete the migration.'],
        path: meta.file,
      });
    }
    return lowerRenameCompound(state, meta, fromCollection, [], toCollection, []);
  }

  const fromSegments = fieldSegments(meta, from.field);
  const toSegments = fieldSegments(meta, to.field);
  const { reading, fromLive } = await resolveReading(
    state,
    meta,
    from,
    fromSegments,
    to,
    toSegments,
    transform,
  );

  if (reading === 'column') {
    return {
      kind: 'move',
      from: await lowerColumn(state, meta, from, fromCollection, fromSegments, 'from', fromLive),
      to: await lowerColumn(state, meta, to, toCollection, toSegments, 'to', fromLive),
      toSubtree: { collection: toCollection, path: toSegments },
      transform,
    };
  }

  if (fromCollection !== toCollection) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames a field across collections`,
      body: [
        `\`${fromCollection}.${from.field}\` cannot become \`${toCollection}.${to.field}\`: a rename stays within its collection.`,
        'Rename the collection separately, or move the data instead.',
      ],
      path: meta.file,
    });
  }
  if (
    fromSegments.length !== toSegments.length ||
    fromSegments.slice(0, -1).some((segment, index) => segment !== toSegments[index])
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames across the field tree`,
      body: [
        `\`${from.field}\` cannot become \`${to.field}\`: a rename changes the last path segment only.`,
        'Rename the parent composite separately.',
      ],
      path: meta.file,
    });
  }
  if (from.field === to.field) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames \`${fromCollection}.${from.field}\` onto itself`,
      body: ['Point `to` at the new field name, or delete the migration.'],
      path: meta.file,
    });
  }
  return lowerRenameCompound(state, meta, fromCollection, fromSegments, toCollection, toSegments);
}

/**
 * Resolves whether a logical pair addresses a column or a derived table.
 *
 * `transform` or a `type` pin selects the column reading outright.
 * A pin aimed at a field that lives only as a table refuses and names itself as the cause.
 * Otherwise the live `from` decides: a live column reads as a move, a live derived table as a rename.
 * Both live at once refuses, naming the escape hatches.
 * With no live evidence the `to` side decides the reading, desired first, then live.
 * The desired schema never holds both readings: one field materializes as one storage shape.
 *
 * `fromLive` reports whether the `from` column is live, so the caller knows the move will run:
 * an absent `from` only ever skips or refuses, both blind to the lowered types.
 */
async function resolveReading(
  state: ResolveState,
  meta: MigrationMeta,
  from: LogicalAddress,
  fromSegments: readonly string[],
  to: LogicalAddress,
  toSegments: readonly string[],
  transform: MigrationTransform | undefined,
): Promise<{ reading: 'column' | 'table'; fromLive: boolean }> {
  const fromCollection = from.collection;
  const fromColumn = columnReading(fromCollection, fromSegments);
  const fromTable = tableReading(fromCollection, fromSegments);
  const columnLive = await liveColumn(state, fromColumn.table, fromColumn.column);
  const tableLive = state.names.has(fromTable);
  if (!isUndefined(transform) || !isUndefined(from.type) || !isUndefined(to.type)) {
    if (tableLive && !columnLive) {
      throw ohneError({
        title: `Migration \`${meta.name}\` addresses the table \`${fromTable}\` as a column`,
        body: [
          `\`${fromCollection}.${fromSegments.join('.')}\` is live as the table \`${fromTable}\`, and a transform or \`type\` pin selects the column reading.`,
          'Drop it to rename the table, or address the column you meant.',
        ],
        path: meta.file,
      });
    }
    return { reading: 'column', fromLive: columnLive };
  }
  if (columnLive && tableLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${fromCollection}.${fromSegments.join('.')}\` is a live column on \`${fromColumn.table}\` and the live table \`${fromTable}\` at once.`,
        'Pin `type` to address the column, or use the physical `table` spelling for the table.',
      ],
      path: meta.file,
    });
  }
  if (columnLive) return { reading: 'column', fromLive: true };
  if (tableLive) return { reading: 'table', fromLive: false };

  const toColumn = columnReading(to.collection, toSegments);
  const toTable = tableReading(to.collection, toSegments);
  const desiredTo = state.desired.find((table) => table.name === toColumn.table);
  if (desiredTo?.columns.some((column) => column.name === toColumn.column)) {
    return { reading: 'column', fromLive: false };
  }
  if (state.desired.some((table) => table.name === toTable)) {
    return { reading: 'table', fromLive: false };
  }
  const toColumnLive = await liveColumn(state, toColumn.table, toColumn.column);
  const toTableLive = state.names.has(toTable);
  if (toTableLive && !toColumnLive) return { reading: 'table', fromLive: false };
  return { reading: 'column', fromLive: false };
}

/**
 * Lowers one side of a move to its physical column address, resolving the type it asserts.
 *
 * An explicit `type` wins and stays the live-drift assertion.
 * A `from` falls back to the claim record, then the live column, then a placeholder.
 * The executor never reads the placeholder: an absent `from` skips before any type is read.
 * A `to` falls back to the desired schema, then the claim record, then the live column.
 * A `to` that exists nowhere while the `from` is live demands an explicit `type` to be created as.
 * With the `from` absent the move only skips or refuses, both blind to the types.
 * The `to` then takes the placeholder too, so chains skip end to end unpinned.
 */
async function lowerColumn(
  state: ResolveState,
  meta: MigrationMeta,
  address: LogicalAddress,
  collection: string,
  segments: readonly string[],
  role: 'from' | 'to',
  fromLive: boolean,
): Promise<ColumnAddress> {
  const { table, column } = columnReading(collection, segments);
  if (!isUndefined(address.type)) return { table, column, type: address.type };
  if (role === 'to') {
    const desired = state.desired.find((schema) => schema.name === table);
    const wanted = desired?.columns.find((item) => item.name === column);
    if (!isUndefined(wanted)) return { table, column, type: wanted.type };
  }
  const claimed = state.claimed[table]?.columns[column];
  if (!isUndefined(claimed)) return { table, column, type: claimed };
  if (state.names.has(table)) {
    const live = await state.describe(table);
    const found = live.columns.find((item) => item.name === column);
    if (!isUndefined(found)) return { table, column, type: found.type };
  }
  if (role === 'from' || !fromLive) return { table, column, type: 'text' };
  throw ohneError({
    title: `Migration \`${meta.name}\` needs a \`type\` on its \`to\``,
    body: [
      `\`${collection}.${segments.join('.')}\` exists nowhere yet - neither live nor in the desired schema - so nothing supplies its type.`,
      'Set `type` on the `to` address, so the engine knows what to create the column as.',
    ],
    path: meta.file,
  });
}

/**
 * Lowers a logical rename to its compound: the primary table plus every family member.
 *
 * With ownership the family enumerates from the claims whose origin sits under the `from` path.
 * Each member's new name and claim origin recompute from the `to` side, fresh truncation included.
 * Without ownership the family bootstraps from the `to` tree in the desired schema.
 * Each implied member must then be live while the primary is, or the fields changed with the rename.
 * That combination refuses, never silently partial.
 * A field-path primary takes its origin from the claims, or from the `to` tree when the snapshot lacks it.
 * A derived table must never rename origin-less, or later correlation misreads it.
 * Members order primary first, then by live name, so runs are deterministic.
 */
function lowerRenameCompound(
  state: ResolveState,
  meta: MigrationMeta,
  collection: string,
  fromPath: readonly string[],
  toCollection: string,
  toPath: readonly string[],
): LoweredMigration {
  const fromPrimary =
    fromPath.length === 0
      ? collectionTableName(collection)
      : derivedTableName(collection, fromPath[0] as string, ...fromPath.slice(1));
  const toPrimary =
    toPath.length === 0
      ? collectionTableName(toCollection)
      : derivedTableName(toCollection, toPath[0] as string, ...toPath.slice(1));
  // A field-path primary reads its origin from the claims; a pre-ownership snapshot has none
  // there, so the desired `to` tree supplies it - the claim must never rename origin-less.
  const claimedOrigin = fromPath.length === 0 ? undefined : state.claimed[fromPrimary]?.derived;
  const primaryOrigin = isUndefined(claimedOrigin)
    ? state.desired.find((table) => table.name === toPrimary)?.derived
    : {
        ...claimedOrigin,
        collection: toCollection,
        path: renamedPath(claimedOrigin.path, fromPath, toPath),
      };
  if (
    fromPath.length > 0 &&
    isUndefined(primaryOrigin) &&
    !state.ownership &&
    state.names.has(fromPrimary)
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot verify the rename family`,
      body: [
        'The schema snapshot comes from an older ohne and does not record which tables the collection owns.',
        `The renamed family recomputes from the new field tree instead - and \`${toPrimary}\` is not in it, so the fields changed in the same deploy as the rename.`,
        'Deploy the rename alone on the unchanged fields first, or rename the tables physically.',
      ],
      path: meta.file,
    });
  }
  const members: RenameMember[] = [
    {
      from: fromPrimary,
      to: toPrimary,
      origin: fromPath.length === 0 ? undefined : primaryOrigin,
    },
  ];

  if (state.ownership) {
    for (const [table, claim] of Object.entries(state.claimed)) {
      const origin = claim.derived;
      if (
        isUndefined(origin) ||
        origin.collection !== collection ||
        !pathStartsWith(origin.path, fromPath) ||
        table === fromPrimary
      ) {
        continue;
      }
      const path = renamedPath(origin.path, fromPath, toPath);
      members.push({
        from: table,
        to: derivedTableName(toCollection, path[0] as string, ...path.slice(1)),
        origin: { ...origin, collection: toCollection, path },
      });
    }
  } else {
    const primaryLive = state.names.has(fromPrimary);
    for (const table of state.desired) {
      const origin = table.derived;
      if (
        isUndefined(origin) ||
        origin.collection !== toCollection ||
        !pathStartsWith(origin.path, toPath) ||
        table.name === toPrimary
      ) {
        continue;
      }
      const fromMemberPath = renamedPath(origin.path, toPath, fromPath);
      const fromMember = derivedTableName(
        collection,
        fromMemberPath[0] as string,
        ...fromMemberPath.slice(1),
      );
      if (state.names.has(fromMember)) {
        members.push({ from: fromMember, to: table.name, origin });
      } else if (primaryLive) {
        throw ohneError({
          title: `Migration \`${meta.name}\` cannot verify the rename family`,
          body: [
            'The schema snapshot comes from an older ohne and does not record which tables the collection owns.',
            `The renamed family recomputes from the new field tree instead - and its member \`${fromMember}\` is not live, so the fields changed in the same deploy as the rename.`,
            'Deploy the rename alone on the unchanged fields first, or rename the tables physically.',
          ],
          path: meta.file,
        });
      }
    }
  }

  const [primary, ...rest] = members;
  rest.sort((a, b) => (a.from < b.from ? -1 : 1));
  return {
    kind: 'compoundRename',
    members: [primary as RenameMember, ...rest],
    to: { collection: toCollection, path: toPath },
  };
}

/**
 * Lowers a logical discard: the reading decides between a column drop and a table compound.
 *
 * A field that materialized as a live column drops as a column.
 * A live derived table drops as a table with every nested child, deepest first.
 * Both at once refuses unless `type` pins the column; the physical spelling stays the escape hatch.
 * A collection-level discard drops the whole family, the main table last.
 * Without ownership the family cannot be enumerated, so table-grain discards refuse.
 */
async function lowerDiscard(
  state: ResolveState,
  meta: MigrationMeta,
  from: LogicalAddress,
): Promise<LoweredMigration> {
  const collection = logicalCollection(meta, from);

  if (isUndefined(from.field)) {
    if (!isUndefined(from.type)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pins a \`type\` without a field`,
        body: ['A collection discard names no column.', 'Name the field, or drop `type`.'],
        path: meta.file,
      });
    }
    assertOwnership(state, meta, collection);
    return {
      kind: 'compoundDiscard',
      tables: discardFamily(state, collection, [], collectionTableName(collection)),
    };
  }

  const segments = fieldSegments(meta, from.field);
  const column = columnReading(collection, segments);
  const table = tableReading(collection, segments);
  const columnLive = await liveColumn(state, column.table, column.column);
  const tableLive = state.names.has(table);

  if (!isUndefined(from.type) || (columnLive && !tableLive)) {
    const type =
      from.type ??
      state.claimed[column.table]?.columns[column.column] ??
      (columnLive
        ? (await state.describe(column.table)).columns.find((item) => item.name === column.column)
            ?.type
        : undefined) ??
      'text';
    return { kind: 'discardColumn', from: { table: column.table, column: column.column, type } };
  }

  if (columnLive && tableLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${collection}.${from.field}\` is a live column on \`${column.table}\` and the live table \`${table}\` at once.`,
        'Pin `type` to discard the column, or use the physical `table` spelling for the table.',
      ],
      path: meta.file,
    });
  }

  if (tableLive) {
    assertOwnership(state, meta, `${collection}.${from.field}`);
    return { kind: 'compoundDiscard', tables: discardFamily(state, collection, segments, table) };
  }

  return {
    kind: 'discardColumn',
    from: { table: column.table, column: column.column, type: 'text' },
  };
}

/**
 * The tables a table-grain discard drops: the family under the path, deepest first, primary last.
 */
function discardFamily(
  state: ResolveState,
  collection: string,
  path: readonly string[],
  primary: string,
): string[] {
  const family = Object.entries(state.claimed)
    .filter(([table, claim]) => {
      const origin = claim.derived;
      return (
        !isUndefined(origin) &&
        origin.collection === collection &&
        pathStartsWith(origin.path, path) &&
        table !== primary
      );
    })
    .map(([table, claim]) => ({ table, depth: claim.derived?.path.length ?? 0 }))
    .sort((a, b) => b.depth - a.depth || (a.table < b.table ? -1 : 1))
    .map((entry) => entry.table);
  return [...family, primary];
}

/**
 * The refusal for a family operation under a snapshot that never recorded ownership.
 */
function assertOwnership(state: ResolveState, meta: MigrationMeta, subject: string): void {
  if (state.ownership) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` cannot enumerate \`${subject}\``,
    body: [
      'The schema snapshot comes from an older ohne and does not record which tables the discard covers.',
      'Boot or `ohne sync` once on the current schema first, or discard the tables physically.',
    ],
    path: meta.file,
  });
}

/**
 * Whether `table` exists live and holds `column`, the structural half of the reading resolution.
 */
async function liveColumn(state: ResolveState, table: string, column: string): Promise<boolean> {
  if (!state.names.has(table)) return false;
  const schema = await state.describe(table);
  return schema.columns.some((item) => item.name === column);
}

/**
 * The physical column reading of a field path: the table its prefix names, plus the last segment.
 */
function columnReading(
  collection: string,
  segments: readonly string[],
): { table: string; column: string } {
  const column = segments[segments.length - 1] as string;
  const prefix = segments.slice(0, -1);
  const table =
    prefix.length === 0
      ? collectionTableName(collection)
      : derivedTableName(collection, prefix[0] as string, ...prefix.slice(1));
  return { table, column };
}

/**
 * The physical table reading of a field path: the derived table the whole path names.
 */
function tableReading(collection: string, segments: readonly string[]): string {
  return derivedTableName(collection, segments[0] as string, ...segments.slice(1));
}

/**
 * Swaps the `from` path prefix for the `to` path on one family member's origin path.
 */
function renamedPath(
  path: DerivedOrigin['path'],
  fromPath: readonly string[],
  toPath: readonly string[],
): DerivedOrigin['path'] {
  return [...toPath, ...path.slice(fromPath.length)] as unknown as DerivedOrigin['path'];
}

/**
 * Whether `path` starts with every segment of `prefix`; an empty prefix matches everything.
 */
export function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment);
}

/**
 * The shape of one grammar-legal name: a leading letter, then letters and digits, nothing else.
 * Collection and field names never carry `_`, `$`, `.`, or whitespace; those compose physically.
 */
const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * The collection a logical address names, validated against the naming grammar.
 */
function logicalCollection(meta: MigrationMeta, address: LogicalAddress): string {
  const collection = address.collection;
  if (!NAME_SHAPE.test(collection)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` names an invalid collection`,
      body: [
        `\`${collection}\` cannot be a collection: a name is letters and digits, starting with a letter.`,
        'Use the physical `table` spelling for names outside the grammar.',
      ],
      path: meta.file,
    });
  }
  if (RESERVED_COLLECTIONS.has(collection.toLowerCase())) {
    throw ohneError({
      title: `Migration \`${meta.name}\` names the reserved collection \`${collection}\``,
      body: [
        `\`${collection}\` is reserved by the framework, so no collection ever carries it.`,
        'Fix the address.',
      ],
      path: meta.file,
    });
  }
  return collection;
}

/**
 * Splits a field path into its segments, refusing shapes outside the naming grammar.
 */
function fieldSegments(meta: MigrationMeta, field: string): string[] {
  const segments = field.split('.');
  if (segments.some((segment) => !NAME_SHAPE.test(segment))) {
    throw ohneError({
      title: `Migration \`${meta.name}\` has a malformed field path`,
      body: [
        `\`${field}\` does not read as a field path: segments are letter-led names of letters and digits, joined by \`.\`.`,
        'Use the physical `table` and `column` spelling for names outside the grammar.',
      ],
      path: meta.file,
    });
  }
  return segments;
}

/**
 * Refuses an address that carries both the logical and the physical spelling at once.
 */
function assertPurelyLogical(meta: MigrationMeta, address: LogicalAddress): void {
  if (!('table' in address) && !('column' in address)) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` mixes address spellings`,
    body: [
      'An address is logical (`collection`, `field`) or physical (`table`, `column`), never both.',
      'Drop one spelling.',
    ],
    path: meta.file,
  });
}
