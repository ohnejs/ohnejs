import type { SQLParams, SQLValue, Transaction } from '../adapter.ts';
import type { Dialect, LogicalType } from '../dialect.ts';
import type { SchemaClassification } from '../schema/snapshot.ts';
import type { ColumnSchema, DerivedOrigin, TableSchema } from '../schema/table-schema.ts';
import type {
  ColumnAddress,
  MigrationContext,
  MigrationTransform,
  MoveMigration,
  RenameMigration,
  TableAddress,
} from './define-migration.ts';
import type { MigrationStamp } from './state.ts';
import type { MigrationMeta } from './use-migrations.ts';

import { deepEqual, isNull, isUndefined, jsonClone } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { collectionTableName, derivedTableName } from '../naming/table-names.ts';
import { applyClassification } from '../schema/snapshot.ts';

/**
 * One migration run's inputs.
 */
export interface ExecuteMigrationsOptions {
  /**
   * The pending migrations in execution order: furthest layer first, file name order within a layer.
   */
  migrations: readonly MigrationMeta[];

  /**
   * The tables the running code wants live, the source a missing TO materializes from.
   */
  desired: readonly TableSchema[];

  /**
   * The claim record from the snapshot: each owned table's columns and their logical types.
   */
  claimed: SchemaClassification;

  /**
   * Authorizes the value losses a move would otherwise refuse, reporting them as deletions.
   *
   * @default
   * false
   */
  force: boolean;
}

/**
 * What a migration run did, feeding the sync's diff, guard, and snapshot.
 */
export interface MigrationOutcome {
  /**
   * One stamp per pending migration, ready to persist.
   */
  stamps: MigrationStamp[];

  /**
   * The claim record after renames, materializations, and drops.
   */
  claimed: SchemaClassification;

  /**
   * Force-authorized value losses, one report line each.
   */
  deletions: string[];
}

interface Engine {
  db: Transaction;
  dialect: Dialect;
  desired: readonly TableSchema[];
  force: boolean;
  names: Set<string>;
  claimed: SchemaClassification;
  deletions: string[];
}

type MigrationForm =
  | { kind: 'move'; from: ColumnAddress; to: ColumnAddress; transform?: MigrationTransform }
  | { kind: 'rename'; from: TableAddress; to: TableAddress }
  | { kind: 'discardColumn'; from: ColumnAddress }
  | { kind: 'discardTable'; from: TableAddress };

/**
 * The row correlation of a move: which source columns look up the target row to write.
 */
interface Correlation {
  sourceKey: readonly string[];
  targetKey: readonly string[];
}

/**
 * Runs every pending migration in order, inside the sync's transaction, before the structural diff.
 *
 * Each migration mutates live structure itself.
 * A move materializes a missing TO, carries values through the dialect codec, and drops FROM.
 * A rename renames; a discard drops.
 * FROM must match the live schema - a drifted type is a hard error, never a silent skip.
 * A FROM that is entirely absent skips and stamps, but only when TO is already satisfied.
 * TO is satisfied when it is live, in the desired schema, or consumed by a later pending migration.
 * Chains therefore skip end to end.
 * Everything else refuses loudly and rolls the sync back.
 */
export async function executeMigrations(
  db: Transaction,
  dialect: Dialect,
  options: ExecuteMigrationsOptions,
): Promise<MigrationOutcome> {
  const engine: Engine = {
    db,
    dialect,
    desired: options.desired,
    force: options.force,
    names: new Set(await dialect.listTables(db)),
    claimed: jsonClone(options.claimed),
    deletions: [],
  };
  const queue = options.migrations.map((meta) => ({ meta, form: formOf(meta) }));
  const stamps: MigrationStamp[] = [];
  for (const [index, { meta, form }] of queue.entries()) {
    const later = queue.slice(index + 1).map((entry) => entry.form);
    stamps.push(await runMigration(engine, meta, form, later));
  }
  return { stamps, claimed: engine.claimed, deletions: engine.deletions };
}

/**
 * Normalizes a migration into its executable form.
 * The public union carries no tag: a `null` TO marks a discard, a column in the address marks the level.
 * A `ColumnAddress` satisfies `TableAddress` structurally, so a mixed pair typechecks; refuse it here.
 */
function formOf(meta: MigrationMeta): MigrationForm {
  const { migration } = meta;
  if (isNull(migration.to)) {
    return 'column' in migration.from
      ? { kind: 'discardColumn', from: migration.from }
      : { kind: 'discardTable', from: migration.from };
  }
  const fromColumn = 'column' in migration.from;
  const toColumn = 'column' in migration.to;
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
    const { from, to, transform } = migration as MoveMigration;
    return { kind: 'move', from, to, transform };
  }
  const { from, to } = migration as RenameMigration;
  return { kind: 'rename', from, to };
}

/**
 * Dispatches one migration to its form's runner and returns the stamp to persist.
 */
function runMigration(
  engine: Engine,
  meta: MigrationMeta,
  form: MigrationForm,
  later: readonly MigrationForm[],
): Promise<MigrationStamp> {
  switch (form.kind) {
    case 'move':
      return runMove(engine, meta, form, later);
    case 'rename':
      return runRename(engine, meta, form, later);
    case 'discardColumn':
      return runDiscardColumn(engine, meta, form.from);
    case 'discardTable':
      return runDiscardTable(engine, meta, form.from);
  }
}

/**
 * Renames a table, follows it in the claim record, and cascades over its derived tables.
 * Every junction and child table whose origin names the renamed owner renames with it.
 * Each physical name recomputes from the new owner, fresh truncation hashes included.
 * The new name doubles as the logical owner the derived names recompute from.
 * A cascade onto a name past the physical cap therefore refuses: nothing recomposes from a hash.
 * Constraint names derive from the table name; the sync's diff recreates them under the new one.
 * A case-only rename passes the collision check, since its target is the table itself.
 */
async function runRename(
  engine: Engine,
  meta: MigrationMeta,
  form: { from: TableAddress; to: TableAddress },
  later: readonly MigrationForm[],
): Promise<MigrationStamp> {
  const { from, to } = form;
  if (foreign(engine, from.table)) refuseForeign(meta, from.table);
  if (!present(engine, from.table)) {
    if (!tableSatisfied(engine, to.table, later)) {
      refuseUnrunnable(meta, `\`${from.table}\``, `\`${to.table}\``);
    }
    return skipStamp(meta, `\`${from.table}\` is absent and \`${to.table}\` is satisfied`);
  }
  const derived = Object.entries(engine.claimed)
    .flatMap(([table, claim]) =>
      isUndefined(claim.derived) ||
      collectionTableName(claim.derived.collection) !== from.table ||
      !engine.names.has(table)
        ? []
        : [{ table, claim, origin: claim.derived }],
    )
    .sort((a, b) => (a.table < b.table ? -1 : 1));
  if (derived.length > 0 && to.table.includes('$')) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot cascade onto a truncated name`,
      body: [
        `\`${to.table}\` is capped at the physical boundary, so the names of the derived tables owned by \`${from.table}\` cannot recompose from it.`,
        'Pick a collection name under the cap.',
      ],
      path: meta.file,
    });
  }
  await renameOwned(engine, meta, from.table, to.table);
  for (const { table, claim, origin } of derived) {
    const renamed = derivedTableName(to.table, ...origin.path);
    await renameOwned(engine, meta, table, renamed);
    engine.claimed[renamed] = { ...claim, derived: { ...origin, collection: to.table } };
  }
  return { name: meta.name, status: 'applied' };
}

/**
 * Renames one owned table: collision-checked, executed, and followed in the run's bookkeeping.
 */
async function renameOwned(
  engine: Engine,
  meta: MigrationMeta,
  from: string,
  to: string,
): Promise<void> {
  const taken = [...engine.names].find(
    (name) => name.toLowerCase() === to.toLowerCase() && name !== from,
  );
  if (!isUndefined(taken)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames onto an existing table`,
      body: [
        `\`${from}\` cannot become \`${to}\`: \`${taken}\` already exists.`,
        'Migrate the occupying table away first, or pick another name.',
      ],
      path: meta.file,
    });
  }
  await engine.dialect.renameTable(engine.db, from, to);
  engine.names.delete(from);
  engine.names.add(to);
  engine.claimed[to] = engine.claimed[from] ?? { columns: {} };
  delete engine.claimed[from];
}

/**
 * Drops a whole table on purpose; the discard is the authorization, so the guard never sees it.
 */
async function runDiscardTable(
  engine: Engine,
  meta: MigrationMeta,
  from: TableAddress,
): Promise<MigrationStamp> {
  if (foreign(engine, from.table)) refuseForeign(meta, from.table);
  if (!present(engine, from.table)) {
    return skipStamp(meta, `\`${from.table}\` is already absent`);
  }
  const schema = await describe(engine, from.table);
  await engine.dialect.applyTableDiff(engine.db, { kind: 'drop', table: schema });
  engine.names.delete(from.table);
  delete engine.claimed[from.table];
  return { name: meta.name, status: 'applied' };
}

/**
 * Drops one column on purpose, its covering indexes and foreign key with it.
 */
async function runDiscardColumn(
  engine: Engine,
  meta: MigrationMeta,
  from: ColumnAddress,
): Promise<MigrationStamp> {
  if (foreign(engine, from.table)) refuseForeign(meta, from.table);
  if (!present(engine, from.table)) {
    return skipStamp(meta, `\`${from.table}\` is already absent`);
  }
  const schema = await describe(engine, from.table);
  const column = schema.columns.find((item) => item.name === from.column);
  if (isUndefined(column)) {
    return skipStamp(meta, `\`${from.table}.${from.column}\` is already absent`);
  }
  assertColumnMatches(engine, meta, from, column);
  assertNotPrimaryKey(meta, schema, from);
  await dropColumn(engine, schema, column);
  delete engine.claimed[from.table]?.columns[from.column];
  return { name: meta.name, status: 'applied' };
}

/**
 * Moves a column's values onto another column, in place, across columns, or across tables.
 * Every row is read first; an in-place retype then swaps the column's physical type, nullable.
 * The held values are written back as the TO type - the old affinity would mangle them otherwise.
 * A cross move materializes TO, carries values row by row, then drops FROM.
 */
async function runMove(
  engine: Engine,
  meta: MigrationMeta,
  form: { from: ColumnAddress; to: ColumnAddress; transform?: MigrationTransform },
  later: readonly MigrationForm[],
): Promise<MigrationStamp> {
  const { from, to } = form;
  if (foreign(engine, from.table)) refuseForeign(meta, from.table);
  const source = present(engine, from.table) ? await describe(engine, from.table) : undefined;
  const column = source?.columns.find((item) => item.name === from.column);
  if (isUndefined(source) || isUndefined(column)) {
    if (!(await columnSatisfied(engine, to, later))) {
      refuseUnrunnable(meta, `\`${from.table}.${from.column}\``, `\`${to.table}.${to.column}\``);
    }
    return skipStamp(
      meta,
      `\`${from.table}.${from.column}\` is absent and \`${to.table}.${to.column}\` is satisfied`,
    );
  }
  assertColumnMatches(engine, meta, from, column);
  assertNotPrimaryKey(meta, source, from);
  const inPlace = from.table === to.table && from.column === to.column;
  const rows = await readRows(engine, source);
  const target = inPlace
    ? await retypeInPlace(engine, source, column, to)
    : await materializeTarget(engine, meta, to);
  await writeValues(engine, meta, form, source, target, rows);
  setClaim(engine, to.table, to.column, to.type);
  if (inPlace) return { name: meta.name, status: 'applied' };
  const fresh = await describe(engine, from.table);
  const dropped = fresh.columns.find((item) => item.name === from.column);
  if (!isUndefined(dropped)) await dropColumn(engine, fresh, dropped);
  delete engine.claimed[from.table]?.columns[from.column];
  return { name: meta.name, status: 'applied' };
}

/**
 * Physically retypes a column, nullable, leaving it empty; the caller holds the values.
 * Writing new-type values into the old declaration would run them through the old affinity.
 * The shape changes first; the values land after.
 * Types sharing a native column type change nothing; the values rewrite in place.
 */
async function retypeInPlace(
  engine: Engine,
  schema: TableSchema,
  column: ColumnSchema,
  to: ColumnAddress,
): Promise<TableSchema> {
  if (engine.dialect.columnType(column.type) === engine.dialect.columnType(to.type)) return schema;
  const desired: ColumnSchema = { name: column.name, type: to.type, notNull: false };
  await engine.dialect.applyTableDiff(engine.db, {
    kind: 'alter',
    live: schema,
    desired: {
      ...schema,
      columns: schema.columns.map((item) => (item.name === column.name ? desired : item)),
    },
    addColumns: [],
    dropColumns: [],
    changeColumns: [{ live: column, desired }],
    changePrimaryKey: false,
    addUniques: [],
    dropUniques: [],
    addIndexes: [],
    dropIndexes: [],
    addForeignKeys: [],
    dropForeignKeys: [],
  });
  return describe(engine, schema.name);
}

/**
 * Ensures the move's target column exists, creating the table or the column from what is known.
 * A missing table comes from the desired schema, without uniques and indexes.
 * The sync's diff re-adds them after the guard probes them.
 * A missing column comes from the address itself, nullable; the diff tightens it once values landed.
 */
async function materializeTarget(
  engine: Engine,
  meta: MigrationMeta,
  to: ColumnAddress,
): Promise<TableSchema> {
  if (foreign(engine, to.table)) refuseForeign(meta, to.table);
  if (!present(engine, to.table)) {
    const wanted = engine.desired.find((table) => table.name === to.table);
    if (isUndefined(wanted)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` cannot materialize \`${to.table}\``,
        body: [
          `\`${to.table}\` is neither live nor in the desired schema, so there is nothing to create it from.`,
          'Fix the migration address, or add the table to the schema.',
        ],
        path: meta.file,
      });
    }
    await engine.dialect.applyTableDiff(engine.db, {
      kind: 'create',
      table: { ...wanted, uniques: [], indexes: [] },
    });
    engine.names.add(to.table);
    const columns = Object.fromEntries(wanted.columns.map((item) => [item.name, item.type]));
    engine.claimed[to.table] = isUndefined(wanted.derived)
      ? { columns }
      : { columns, derived: wanted.derived };
  }
  const schema = await describe(engine, to.table);
  const column = schema.columns.find((item) => item.name === to.column);
  if (!isUndefined(column)) {
    assertColumnMatches(engine, meta, to, column);
    assertNotPrimaryKey(meta, schema, to);
    return schema;
  }
  const added: ColumnSchema = { name: to.column, type: to.type, notNull: false };
  await engine.dialect.applyTableDiff(engine.db, {
    kind: 'alter',
    live: schema,
    desired: { ...schema, columns: [...schema.columns, added] },
    addColumns: [added],
    dropColumns: [],
    changeColumns: [],
    changePrimaryKey: false,
    addUniques: [],
    dropUniques: [],
    addIndexes: [],
    dropIndexes: [],
    addForeignKeys: [],
    dropForeignKeys: [],
  });
  setClaim(engine, to.table, to.column, to.type);
  return describe(engine, to.table);
}

/**
 * Reads every source row up front, before any structural change empties or reshapes a column.
 */
function readRows(engine: Engine, source: TableSchema): Promise<Record<string, SQLValue>[]> {
  const columns = source.columns.map((item) => engine.dialect.quote(item.name)).join(', ');
  return engine.db.query(`SELECT ${columns} FROM ${engine.dialect.quote(source.name)}`);
}

/**
 * Carries every held value through the dialect codec, one row at a time, correlated per classification.
 * A cross-table row with no target row loses its value when FROM drops: refused unless force.
 * Force drops the values and reports them.
 */
async function writeValues(
  engine: Engine,
  meta: MigrationMeta,
  form: { from: ColumnAddress; to: ColumnAddress; transform?: MigrationTransform },
  source: TableSchema,
  target: TableSchema,
  rows: readonly Record<string, SQLValue>[],
): Promise<void> {
  const { db, dialect } = engine;
  const { from, to, transform } = form;
  const { sourceKey, targetKey } = resolveCorrelation(engine, meta, source, target);
  if (rows.length === 0) return;
  const where = targetKey.map((name) => `${dialect.quote(name)} = ?`).join(' AND ');
  const update = `UPDATE ${dialect.quote(to.table)} SET ${dialect.quote(to.column)} = ? WHERE ${where}`;
  const ctx: MigrationContext = {
    query: <T>(sql: string, params?: SQLParams) => db.query<T>(sql, params),
    queryOne: <T>(sql: string, params?: SQLParams) => db.queryOne<T>(sql, params),
  };
  let unmatched = 0;
  for (const row of rows) {
    const value = dialect.deserialize(from.type, row[from.column] ?? null);
    const output = isUndefined(transform)
      ? value
      : await transform(value, deserializeRow(dialect, source, row), ctx);
    const params = [
      dialect.serialize(to.type, output),
      ...sourceKey.map((name) => row[name] ?? null),
    ];
    const { changes } = await db.run(update, params);
    if (changes === 0) unmatched++;
  }
  if (unmatched === 0) return;
  if (!engine.force) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot map every row`,
      body: [
        `\`${unmatched}\` rows of \`${from.table}\` have no \`${to.table}\` row to receive their \`${from.column}\` value.`,
        '',
        'Create the missing rows, or set `FORCE_SYNC` or `database.sync.force` to drop these values for one boot.',
      ],
      path: meta.file,
    });
  }
  engine.deletions.push(
    `- \`${unmatched}\` \`${from.table}.${from.column}\` values had no \`${to.table}\` row to move onto`,
  );
}

/**
 * Resolves how source rows map onto target rows, pinned by table classification.
 *
 * Within one table, the row is its own target, keyed by the primary key.
 * A child table moving onto its parent joins `_parentUUID = UUID`.
 * A parent moving onto its child-one table joins the other way around.
 * A child-many table holds many rows per parent, so no row mapping exists in either direction.
 * Everything else correlates by equal primary key: the source must own one and the target must share it.
 */
function resolveCorrelation(
  engine: Engine,
  meta: MigrationMeta,
  source: TableSchema,
  target: TableSchema,
): Correlation {
  if (source.name !== target.name) {
    const sourceOrigin = engine.claimed[source.name]?.derived;
    if (!isUndefined(sourceOrigin) && parentTableOf(sourceOrigin) === target.name) {
      if (sourceOrigin.kind === 'childMany') refuseManyRows(meta, source.name, target.name);
      if (sourceOrigin.kind === 'childOne') {
        return { sourceKey: ['_parentUUID'], targetKey: ['UUID'] };
      }
    }
    const targetOrigin = engine.claimed[target.name]?.derived;
    if (!isUndefined(targetOrigin) && parentTableOf(targetOrigin) === source.name) {
      if (targetOrigin.kind === 'childMany') refuseManyRows(meta, target.name, source.name);
      if (targetOrigin.kind === 'childOne') {
        return { sourceKey: ['UUID'], targetKey: ['_parentUUID'] };
      }
    }
  }
  if (source.primaryKey.length === 0) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot correlate rows`,
      body: [`\`${source.name}\` has no primary key to correlate rows by.`],
      path: meta.file,
    });
  }
  if (deepEqual(source.primaryKey, target.primaryKey)) {
    return { sourceKey: source.primaryKey, targetKey: target.primaryKey };
  }
  throw ohneError({
    title: `Migration \`${meta.name}\` cannot correlate rows`,
    body: [
      `\`${source.name}\` and \`${target.name}\` do not share a primary key, so no row maps onto another.`,
    ],
    path: meta.file,
  });
}

/**
 * The physical table a derived table hangs off: its collection, or the next composite up.
 */
function parentTableOf(origin: DerivedOrigin): string {
  const [first, ...rest] = origin.path;
  if (rest.length === 0) return collectionTableName(origin.collection);
  return derivedTableName(origin.collection, first, ...rest.slice(0, -1));
}

/**
 * The refusal for a move touching a child-many table across tables: no single row wins.
 */
function refuseManyRows(meta: MigrationMeta, child: string, parent: string): never {
  throw ohneError({
    title: `Migration \`${meta.name}\` cannot correlate rows`,
    body: [`\`${child}\` holds many rows per \`${parent}\` row, so no row maps onto another.`],
    path: meta.file,
  });
}

/**
 * Drops one column through a per-table diff, its covering indexes and foreign key with it.
 * The dialect decides in place versus rebuild, exactly as it does for the sync's own diffs.
 */
async function dropColumn(
  engine: Engine,
  schema: TableSchema,
  column: ColumnSchema,
): Promise<void> {
  const name = column.name;
  await engine.dialect.applyTableDiff(engine.db, {
    kind: 'alter',
    live: schema,
    desired: {
      ...schema,
      columns: schema.columns.filter((item) => item.name !== name),
      uniques: schema.uniques.filter((unique) => !unique.columns.includes(name)),
      indexes: schema.indexes.filter((index) => !index.columns.includes(name)),
      foreignKeys: schema.foreignKeys.filter((foreignKey) => foreignKey.column !== name),
    },
    addColumns: [],
    dropColumns: [column],
    changeColumns: [],
    changePrimaryKey: false,
    addUniques: [],
    dropUniques: schema.uniques.filter((unique) => unique.columns.includes(name)),
    addIndexes: [],
    dropIndexes: schema.indexes.filter((index) => index.columns.includes(name)),
    addForeignKeys: [],
    dropForeignKeys: schema.foreignKeys.filter((foreignKey) => foreignKey.column === name),
  });
}

/**
 * Whether a rename's target is already realized: live and owned, desired, or consumed by a later FROM.
 */
function tableSatisfied(engine: Engine, table: string, later: readonly MigrationForm[]): boolean {
  if (present(engine, table)) return true;
  if (engine.desired.some((schema) => schema.name === table)) return true;
  return later.some((form) => form.from.table === table);
}

/**
 * Whether a move's target column is already realized: live, desired, or consumed by a later FROM.
 * A later whole-table FROM counts, since it consumes every column on it.
 */
async function columnSatisfied(
  engine: Engine,
  address: ColumnAddress,
  later: readonly MigrationForm[],
): Promise<boolean> {
  if (present(engine, address.table)) {
    const schema = await describe(engine, address.table);
    if (schema.columns.some((column) => column.name === address.column)) return true;
  }
  const wanted = engine.desired.find((table) => table.name === address.table);
  if (!isUndefined(wanted) && wanted.columns.some((column) => column.name === address.column)) {
    return true;
  }
  return later.some((form) =>
    'column' in form.from
      ? form.from.table === address.table && form.from.column === address.column
      : form.from.table === address.table,
  );
}

/**
 * A drifted FROM or TO is a hard error naming the mismatch, never a silent skip.
 * Types compare through the dialect, so two primitives sharing a native type never differ.
 */
function assertColumnMatches(
  engine: Engine,
  meta: MigrationMeta,
  address: ColumnAddress,
  live: ColumnSchema,
): void {
  if (engine.dialect.columnType(live.type) === engine.dialect.columnType(address.type)) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` does not match the live schema`,
    body: [
      `\`${address.table}.${address.column}\` holds \`${live.type}\` live, not the expected \`${address.type}\`.`,
      'Fix the migration, or the schema drift behind it.',
    ],
    path: meta.file,
  });
}

/**
 * A primary-key column can neither move, drop, nor be written over; the key identifies the rows.
 */
function assertNotPrimaryKey(
  meta: MigrationMeta,
  schema: TableSchema,
  address: ColumnAddress,
): void {
  if (!schema.primaryKey.includes(address.column)) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` touches a primary-key column`,
    body: [
      `\`${address.table}.${address.column}\` is part of the primary key, which migrations never touch.`,
    ],
    path: meta.file,
  });
}

/**
 * Describes a live table with its claimed logical types restored, so transforms see booleans as booleans.
 */
async function describe(engine: Engine, table: string): Promise<TableSchema> {
  const schema = await engine.dialect.describeTable(engine.db, table);
  const [classified] = applyClassification([schema], engine.claimed, engine.dialect);
  return classified ?? schema;
}

/**
 * Deserializes a raw row by each column's logical type, for the transform's `row` argument.
 */
function deserializeRow(
  dialect: Dialect,
  schema: TableSchema,
  row: Record<string, SQLValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    schema.columns.map((column) => [
      column.name,
      dialect.deserialize(column.type, row[column.name] ?? null),
    ]),
  );
}

/**
 * Whether `table` exists live and the claim record owns it.
 * A migration earlier in the run keeps both in step, so presence follows the run's own changes.
 */
function present(engine: Engine, table: string): boolean {
  return engine.names.has(table) && !isUndefined(engine.claimed[table]);
}

/**
 * Whether `table` exists live without a claim - someone else's table, untouchable.
 */
function foreign(engine: Engine, table: string): boolean {
  return engine.names.has(table) && isUndefined(engine.claimed[table]);
}

/**
 * Records a column's logical type in the claim record.
 */
function setClaim(engine: Engine, table: string, column: string, type: LogicalType): void {
  (engine.claimed[table] ??= { columns: {} }).columns[column] = type;
}

/**
 * The stamp of a migration that found nothing to do.
 */
function skipStamp(meta: MigrationMeta, reason: string): MigrationStamp {
  return { name: meta.name, status: 'skipped', reason };
}

/**
 * The hard refusal for a FROM that is absent while TO is nowhere: a stale or mistyped migration.
 */
function refuseUnrunnable(meta: MigrationMeta, from: string, to: string): never {
  throw ohneError({
    title: `Migration \`${meta.name}\` cannot run`,
    body: [
      `${from} is absent, and ${to} is nowhere in the live or desired schema.`,
      'Delete the migration if it is stale, or fix its addresses.',
    ],
    path: meta.file,
  });
}

/**
 * The hard refusal for a migration addressing a table ohne does not own.
 */
function refuseForeign(meta: MigrationMeta, table: string): never {
  throw ohneError({
    title: `Migration \`${meta.name}\` targets a foreign table`,
    body: [
      `\`${table}\` exists, but ohne does not own it.`,
      'Move the table out of the database, or fix the migration address.',
    ],
    path: meta.file,
  });
}
