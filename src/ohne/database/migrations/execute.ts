import type { SQLParams, SQLValue, Transaction } from '../adapter.ts';
import type { Dialect, LogicalType } from '../dialect.ts';
import type { SchemaClassification, TableClaim } from '../schema/snapshot.ts';
import type { ColumnSchema, TableSchema } from '../schema/table-schema.ts';
import type {
  ColumnAddress,
  MigrationContext,
  MigrationTransform,
  TableAddress,
} from './define-migration.ts';
import type {
  ConsumedAddress,
  LogicalSubtree,
  LoweredMigration,
  LoweredSwitch,
  RenameMember,
  ResolveState,
} from './resolve-address.ts';
import type { MigrationStamp } from './state.ts';
import type { MigrationMeta } from './use-migrations.ts';

import {
  chunk,
  deepEqual,
  errorMessage,
  isEmpty,
  isNull,
  isUndefined,
  jsonClone,
  last,
  pluralize,
  uuidv7,
} from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import {
  collectionTableName,
  companionTableName,
  derivedParentName,
  derivedRootName,
  derivedTableName,
  ownerTableName,
  type DerivedOwner,
} from '../naming/table-names.ts';
import { sweepWrapperRows, type SweepTable } from '../schema/purge.ts';
import { applyClassification } from '../schema/snapshot.ts';
import { DELETE_RECORD } from './define-migration.ts';
import { consumedByMigration, lowerMigration, pathStartsWith } from './resolve-address.ts';

/**
 * One migration run's inputs.
 */
export interface ExecuteMigrationsOptions {
  /**
   * The pending migrations in execution order: furthest layer first, file name order within a layer.
   */
  migrations: readonly MigrationMeta[];

  /**
   * The tables the running code wants live, the source a missing `to` materializes from.
   */
  desired: readonly TableSchema[];

  /**
   * The claim record from the snapshot: each owned table's columns and their logical types.
   */
  claimed: SchemaClassification;

  /**
   * Authorizes the value losses a move would otherwise refuse, reporting them as deletions.
   */
  force: boolean;

  /**
   * Whether the snapshot recorded derivation ownership on its claims.
   * Without it, a logical rename verifies its family through the `to` tree and a table discard refuses.
   *
   * @default
   * true
   */
  ownership?: boolean;

  /**
   * The locale the flip machinery pivots on; nothing stores it.
   * The fan-out lands existing values on it, and a transform-less fan-in promotes and keeps its rows.
   *
   * @default
   * 'en'
   */
  defaultLocale?: string;
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
  ownership: boolean;
  defaultLocale: string;
  names: Set<string>;
  claimed: SchemaClassification;
  deletions: string[];
}

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
 * Each migration lowers to physical form just in time, against the state its predecessors left.
 * Each migration mutates live structure itself.
 * A move materializes a missing `to`, carries values through the dialect codec, and drops `from`.
 * A rename renames; a discard drops.
 * A logical collection rename or discard runs as a compound, one member op per owned table.
 * `from` must match the live schema - a drifted type is a hard error, never a silent skip.
 * A `from` that is entirely absent skips and stamps, but only when `to` is already satisfied.
 * `to` is satisfied when it is live, in the desired schema, or consumed by a later pending migration.
 * Chains therefore skip end to end.
 * Everything else refuses loudly and rolls the sync back.
 *
 * The automatic off -> on fan-out runs last, over whatever flips the migrations left uncovered.
 * A field turned translatable moves its values to the default locale and sheds its main column here.
 * The diff that follows therefore never sees a loss.
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
    ownership: options.ownership ?? true,
    defaultLocale: options.defaultLocale ?? 'en',
    names: new Set(await dialect.listTables(db)),
    claimed: jsonClone(options.claimed),
    deletions: [],
  };
  const queue = options.migrations.map((meta) => ({ meta, consumed: consumedByMigration(meta) }));
  const stamps: MigrationStamp[] = [];
  for (const [index, { meta }] of queue.entries()) {
    const later = queue.slice(index + 1).flatMap((entry) => entry.consumed);
    const lowered = await lowerMigration(resolveState(engine), meta);
    stamps.push(await runMigration(engine, meta, lowered, later));
  }
  await applyFanOuts(engine);
  return { stamps, claimed: engine.claimed, deletions: engine.deletions };
}

/**
 * The engine's live and desired state, as the address resolver consumes it.
 * The sets and records are the engine's own, so lowering follows the run's mutations just in time.
 */
function resolveState(engine: Engine): ResolveState {
  return {
    names: engine.names,
    claimed: engine.claimed,
    desired: engine.desired,
    ownership: engine.ownership,
    describe: (table) => describe(engine, table),
  };
}

/**
 * Dispatches one lowered migration to its runner and returns the stamp to persist.
 */
function runMigration(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredMigration,
  later: readonly ConsumedAddress[],
): Promise<MigrationStamp> {
  switch (lowered.kind) {
    case 'move':
      return runMove(engine, meta, lowered, later);
    case 'rename':
      return runRename(engine, meta, lowered, later);
    case 'discardColumn':
      return runDiscardColumn(engine, meta, lowered.from);
    case 'discardTable':
      return runDiscardTable(engine, meta, lowered.from);
    case 'compoundRename':
      return runCompoundRename(engine, meta, lowered, later);
    case 'compoundDiscard':
      return runCompoundDiscard(engine, meta, lowered.tables);
    case 'switch':
      return runSwitch(engine, meta, lowered, later);
  }
}

/**
 * Runs a logical rename's members: each present table renames, each absent one skips if satisfied.
 * One identity, one stamp: any applied member stamps `applied`.
 * All skipped stamps `skipped`, naming the members.
 * A block rename then rewrites `_blockType` in every live wrapper, the renamed family included.
 */
async function runCompoundRename(
  engine: Engine,
  meta: MigrationMeta,
  form: {
    members: readonly RenameMember[];
    to: LogicalSubtree;
    blockType?: { from: string; to: string };
  },
  later: readonly ConsumedAddress[],
): Promise<MigrationStamp> {
  let applied = 0;
  const skipped: string[] = [];
  for (const member of form.members) {
    const subtree = isUndefined(member.origin)
      ? form.to
      : {
          collection: member.origin.collection,
          block: member.origin.block,
          path: member.origin.path,
        };
    if (foreign(engine, member.from)) refuseForeign(meta, member.from);
    if (!present(engine, member.from)) {
      if (!tableSatisfied(engine, member.to, later) && !subtreeSatisfied(later, subtree)) {
        refuseUnrunnable(meta, `\`${member.from}\``, `\`${member.to}\``);
      }
      skipped.push(member.from);
      continue;
    }
    await renameOwned(engine, meta, member.from, member.to);
    if (!isUndefined(member.origin)) {
      const claim = engine.claimed[member.to] ?? { columns: {} };
      engine.claimed[member.to] = { ...claim, derived: member.origin };
    } else if (!isUndefined(member.companion)) {
      const claim = engine.claimed[member.to] ?? { columns: {} };
      engine.claimed[member.to] = { ...claim, companion: member.companion };
    } else if (!isUndefined(member.block)) {
      const claim = engine.claimed[member.to] ?? { columns: {} };
      engine.claimed[member.to] = { ...claim, block: member.block };
    }
    applied++;
  }
  if (applied > 0) {
    if (!isUndefined(form.blockType)) await rewriteBlockType(engine, form.blockType);
    return { name: meta.name, status: 'applied' };
  }
  const names = skipped.map((table) => `\`${table}\``).join(', ');
  return skipStamp(
    meta,
    `${names} ${skipped.length === 1 ? 'is' : 'are'} absent and the new names are satisfied`,
  );
}

/**
 * Rewrites a renamed block's `_blockType` value in every live wrapper.
 * Wrapper rows reference blocks polymorphically by name, so no key follows the rename for them.
 * Runs after the members renamed: a nested wrapper the rename carried is already under its new name.
 */
async function rewriteBlockType(
  engine: Engine,
  blockType: { from: string; to: string },
): Promise<void> {
  const { db, dialect } = engine;
  for (const [table, claim] of Object.entries(engine.claimed)) {
    if (claim.derived?.kind !== 'blocksWrapper' || !engine.names.has(table)) continue;
    await db.run(
      `UPDATE ${dialect.quote(table)} SET ${dialect.quote('_blockType')} = ? ` +
        `WHERE ${dialect.quote('_blockType')} = ?`,
      [blockType.to, blockType.from],
    );
  }
}

/**
 * Runs a logical discard's members: each present table drops, each absent one skips.
 * One identity, one stamp: any applied member stamps `applied`.
 * All skipped stamps `skipped`, naming the members.
 */
async function runCompoundDiscard(
  engine: Engine,
  meta: MigrationMeta,
  tables: readonly string[],
): Promise<MigrationStamp> {
  let applied = 0;
  const skipped: string[] = [];
  for (const table of tables) {
    if (foreign(engine, table)) refuseForeign(meta, table);
    if (!present(engine, table)) {
      skipped.push(table);
      continue;
    }
    await dropOwnedTable(engine, table);
    applied++;
  }
  if (applied > 0) return { name: meta.name, status: 'applied' };
  const names = skipped.map((table) => `\`${table}\``).join(', ');
  return skipStamp(meta, `${names} ${skipped.length === 1 ? 'is' : 'are'} already absent`);
}

/**
 * Drops one owned table and follows it in the run's bookkeeping.
 * A blocks wrapper sweeps its block references first: the discard is the authorization.
 * The instances only its rows referenced go with it, reported like every other deletion.
 */
async function dropOwnedTable(engine: Engine, table: string): Promise<void> {
  if (engine.claimed[table]?.derived?.kind === 'blocksWrapper') {
    const universe: SweepTable[] = Object.entries(engine.claimed)
      .filter(([name]) => engine.names.has(name) && name !== table)
      .map(([name, claim]) => ({ name, derived: claim.derived, block: claim.block }));
    engine.deletions.push(...(await sweepWrapperRows(engine.db, engine.dialect, universe, table)));
  }
  const schema = await describe(engine, table);
  await engine.dialect.applyTableDiff(engine.db, { kind: 'drop', table: schema });
  engine.names.delete(table);
  delete engine.claimed[table];
}

/**
 * Renames a table, follows it in the claim record, and cascades over its derived tables.
 * Every junction and child table whose origin names the renamed owner renames with it.
 * The claimed translations companion follows the same way.
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
  later: readonly ConsumedAddress[],
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
      isUndefined(claim.derived.collection) ||
      collectionTableName(claim.derived.collection) !== from.table ||
      !engine.names.has(table)
        ? []
        : [{ table, claim, origin: claim.derived }],
    )
    .sort((a, b) => (a.table < b.table ? -1 : 1));
  const companions = Object.entries(engine.claimed)
    .flatMap(([table, claim]) =>
      isUndefined(claim.companion) ||
      collectionTableName(claim.companion) !== from.table ||
      !engine.names.has(table)
        ? []
        : [{ table, claim }],
    )
    .sort((a, b) => (a.table < b.table ? -1 : 1));
  if ((derived.length > 0 || companions.length > 0) && to.table.includes('$')) {
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
  for (const { table, claim } of companions) {
    const renamed = companionTableName(to.table);
    await renameOwned(engine, meta, table, renamed);
    engine.claimed[renamed] = { ...claim, companion: to.table };
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
  await dropOwnedTable(engine, from.table);
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
 * The held values are written back as the `to` type - the old affinity would mangle them otherwise.
 * A cross move materializes `to`, carries values row by row, then drops `from`.
 */
async function runMove(
  engine: Engine,
  meta: MigrationMeta,
  form: {
    from: ColumnAddress;
    to: ColumnAddress;
    toSubtree?: LogicalSubtree;
    transform?: MigrationTransform;
  },
  later: readonly ConsumedAddress[],
): Promise<MigrationStamp> {
  const { from, to } = form;
  if (foreign(engine, from.table)) refuseForeign(meta, from.table);
  const source = present(engine, from.table) ? await describe(engine, from.table) : undefined;
  const column = source?.columns.find((item) => item.name === from.column);
  if (isUndefined(source) || isUndefined(column)) {
    if (!(await columnSatisfied(engine, to, later)) && !subtreeSatisfied(later, form.toSubtree)) {
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
    const claim: TableClaim = { columns };
    if (!isUndefined(wanted.derived)) claim.derived = wanted.derived;
    if (!isUndefined(wanted.block)) claim.block = wanted.block;
    if (!isUndefined(wanted.companion)) claim.companion = wanted.companion;
    engine.claimed[to.table] = claim;
  }
  const schema = await describe(engine, to.table);
  const column = schema.columns.find((item) => item.name === to.column);
  if (!isUndefined(column)) {
    assertColumnMatches(engine, meta, to, column);
    assertNotPrimaryKey(meta, schema, to);
    return schema;
  }
  await addColumn(engine, schema, { name: to.column, type: to.type, notNull: false });
  setClaim(engine, to.table, to.column, to.type);
  return describe(engine, to.table);
}

/**
 * Adds one column through a per-table diff, always nullable; the sync's diff tightens it later.
 * A `NOT NULL` add would refuse over live rows, and the caller fills the values right after anyway.
 */
async function addColumn(
  engine: Engine,
  schema: TableSchema,
  column: ColumnSchema,
): Promise<TableSchema> {
  await engine.dialect.applyTableDiff(engine.db, {
    kind: 'alter',
    live: schema,
    desired: { ...schema, columns: [...schema.columns, column] },
    addColumns: [column],
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
  return describe(engine, schema.name);
}

/**
 * Applies every off -> on translatable flip the migrations left uncovered, automatic and lossless.
 * Scalar flips move main-column values into default-locale companion rows and shed the main column.
 * Composite flips stamp `_localeCode = defaultLocale` onto the live derived rows.
 * The structural remainder - `NOT NULL` tightening, unique widening - stays with the diff.
 * Its guard probes then pass over the freshly stamped data.
 */
async function applyFanOuts(engine: Engine): Promise<void> {
  for (const wanted of engine.desired) {
    if (!isUndefined(wanted.companion)) {
      await fanOutScalars(engine, wanted, engine.defaultLocale);
    }
    const scoped = wanted.columns.some((column) => column.name === '_localeCode');
    if (!isUndefined(wanted.derived) && scoped) {
      await fanOutDerived(engine, wanted, engine.defaultLocale);
    }
  }
}

/**
 * Fans one collection's freshly translatable columns out to its companion.
 *
 * A flip is a live main column the desired main table lost while the desired companion gained it.
 * The companion materializes nullable and without constraints, exactly as a move target does.
 * Rows already holding the default locale take the values in place; missing ones are inserted.
 * An entity whose flipped values are all `NULL` needs no row: an absent row already reads as `NULL`.
 * The main columns then drop - the engine covers the loss, so the guard has nothing to refuse.
 *
 * A flip that retypes at the same time refuses: values cannot carry across types untransformed.
 * A `NOT NULL` companion column outside the flip refuses too when new rows would need a value for it.
 */
async function fanOutScalars(
  engine: Engine,
  wanted: TableSchema,
  defaultLocale: string,
): Promise<void> {
  const { db, dialect } = engine;
  const collection = wanted.companion as string;
  const main = collectionTableName(collection);
  if (!present(engine, main)) return;
  const live = await describe(engine, main);
  const desiredMain = engine.desired.find((table) => table.name === main);
  const flips = wanted.columns.filter(
    (column) =>
      !column.name.startsWith('_') &&
      live.columns.some((item) => item.name === column.name) &&
      desiredMain?.columns.every((item) => item.name !== column.name) === true,
  );
  if (isEmpty(flips)) return;
  for (const column of flips) {
    const source = live.columns.find((item) => item.name === column.name) as ColumnSchema;
    if (dialect.columnType(source.type) !== dialect.columnType(column.type)) {
      throw ohneError({
        title: `Field \`${collection}.${column.name}\` retypes while turning translatable`,
        body: [
          `The live column holds \`${source.type}\` and the companion wants \`${column.type}\`; the fan-out cannot carry values across types.`,
          'Retype first and flip in the next deploy, or cover the flip with a migration.',
        ],
      });
    }
  }
  const companion = await ensureCompanion(engine, wanted, flips);
  const anyValue = flips
    .map((column) => `${dialect.quote(main)}.${dialect.quote(column.name)} IS NOT NULL`)
    .join(' OR ');
  const missing =
    `FROM ${dialect.quote(main)} WHERE (${anyValue}) AND NOT EXISTS (` +
    `SELECT 1 FROM ${dialect.quote(companion.name)} ` +
    `WHERE ${dialect.quote('_parentUUID')} = ${dialect.quote(main)}.${dialect.quote('UUID')} ` +
    `AND ${dialect.quote('_localeCode')} = ?)`;
  const strict = companion.columns.find(
    (column) =>
      !column.name.startsWith('_') &&
      column.notNull &&
      flips.every((flip) => flip.name !== column.name),
  );
  if (!isUndefined(strict)) {
    const row = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS ${dialect.quote('count')} ${missing}`,
      [defaultLocale],
    );
    if ((row?.count ?? 0) > 0) {
      throw ohneError({
        title: `Cannot fan \`${collection}\` out to its translations`,
        body: [
          `\`${row?.count}\` ${pluralize(row?.count ?? 0, 'entity', 'entities')} ${(row?.count ?? 0) === 1 ? 'needs' : 'need'} a fresh \`${defaultLocale}\` row, and \`${companion.name}.${strict.name}\` is \`NOT NULL\` with nothing to fill it.`,
          `Create the missing \`${defaultLocale}\` rows first, or make \`${strict.name}\` nullable.`,
        ],
      });
    }
  }
  const sets = flips
    .map(
      (column) =>
        `${dialect.quote(column.name)} = (SELECT ${dialect.quote(column.name)} ` +
        `FROM ${dialect.quote(main)} WHERE ${dialect.quote('UUID')} = ` +
        `${dialect.quote(companion.name)}.${dialect.quote('_parentUUID')})`,
    )
    .join(', ');
  await db.run(
    `UPDATE ${dialect.quote(companion.name)} SET ${sets} WHERE ${dialect.quote('_localeCode')} = ? ` +
      `AND EXISTS (SELECT 1 FROM ${dialect.quote(main)} WHERE ${dialect.quote('UUID')} = ` +
      `${dialect.quote(companion.name)}.${dialect.quote('_parentUUID')})`,
    [defaultLocale],
  );
  const names = flips.map((column) => dialect.quote(column.name)).join(', ');
  await db.run(
    `INSERT INTO ${dialect.quote(companion.name)} ` +
      `(${dialect.quote('_parentUUID')}, ${dialect.quote('_localeCode')}, ${names}) ` +
      `SELECT ${dialect.quote('UUID')}, ?, ${names} ${missing}`,
    [defaultLocale, defaultLocale],
  );
  for (const column of flips) {
    const fresh = await describe(engine, main);
    const dropped = fresh.columns.find((item) => item.name === column.name);
    if (!isUndefined(dropped)) await dropColumn(engine, fresh, dropped);
    delete engine.claimed[main]?.columns[column.name];
  }
}

/**
 * Ensures a fan-out's companion exists with every flipped column present, all of them nullable.
 * A fresh companion relaxes its user columns and skips constraints, exactly as a move target does.
 * The sync's diff tightens and re-adds them once the values landed, each add probed by the guard.
 */
async function ensureCompanion(
  engine: Engine,
  wanted: TableSchema,
  flips: readonly ColumnSchema[],
): Promise<TableSchema> {
  if (!present(engine, wanted.name)) {
    const relaxed = wanted.columns.map((column) =>
      column.name.startsWith('_') ? column : { ...column, notNull: false },
    );
    await engine.dialect.applyTableDiff(engine.db, {
      kind: 'create',
      table: { ...wanted, columns: relaxed, uniques: [], indexes: [] },
    });
    engine.names.add(wanted.name);
    engine.claimed[wanted.name] = {
      columns: Object.fromEntries(wanted.columns.map((item) => [item.name, item.type])),
      companion: wanted.companion as string,
    };
    return describe(engine, wanted.name);
  }
  let schema = await describe(engine, wanted.name);
  for (const flip of flips) {
    if (schema.columns.some((item) => item.name === flip.name)) continue;
    schema = await addColumn(engine, schema, { ...flip, notNull: false });
    setClaim(engine, wanted.name, flip.name, flip.type);
  }
  return schema;
}

/**
 * Fans one freshly locale-scoped derived table out: `_localeCode` arrives stamped `defaultLocale`.
 * The column lands nullable and full; the diff tightens it to `NOT NULL` over zero probed NULLs.
 * The `one`-cardinality unique and a junction's link unique widen through the same diff.
 */
async function fanOutDerived(
  engine: Engine,
  wanted: TableSchema,
  defaultLocale: string,
): Promise<void> {
  if (!present(engine, wanted.name)) return;
  const live = await describe(engine, wanted.name);
  if (live.columns.some((column) => column.name === '_localeCode')) return;
  await addColumn(engine, live, { name: '_localeCode', type: 'text', notNull: false });
  await engine.db.run(
    `UPDATE ${engine.dialect.quote(wanted.name)} SET ${engine.dialect.quote('_localeCode')} = ?`,
    [defaultLocale],
  );
  setClaim(engine, wanted.name, '_localeCode', 'text');
}

/**
 * Runs one switch migration: asserts the live state, flips the data, and stamps.
 *
 * A binary state has one other value, so a live state on the target side is already switched.
 * That case skips with a reason - the switch analog of a move's absent `from`.
 * An absent field skips when the desired schema or a later migration covers it, and refuses otherwise.
 * A target state equal to `from` refuses too: the desired schema never flips it, so nothing can run.
 * A `translatable` on -> off runs the fan-in.
 * Off -> on reshapes the automatic fan-out's values, or leaves the mechanics to it entirely.
 * The other switches run the transform once per row; the structural change stays with the diff.
 */
async function runSwitch(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
  later: readonly ConsumedAddress[],
): Promise<MigrationStamp> {
  if (foreign(engine, lowered.table)) refuseForeign(meta, lowered.table);
  const subject = isUndefined(lowered.column)
    ? `\`${lowered.table}\``
    : `\`${lowered.table}.${lowered.column}\``;
  const desiredState = desiredSwitchState(engine, lowered);
  if (!isUndefined(lowered.to) && !isUndefined(desiredState) && lowered.to !== desiredState) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches against the desired schema`,
      body: [
        `\`to\` asserts \`${lowered.attribute}: ${lowered.to}\`, and the desired schema wants \`${desiredState}\`.`,
        'Align the migration with the schema, or drop `to`.',
      ],
      path: meta.file,
    });
  }
  const target = lowered.to ?? desiredState;
  const live = await liveSwitchState(engine, meta, lowered);
  if (isUndefined(live)) {
    const subtree = isUndefined(switchOwner(lowered))
      ? undefined
      : { collection: lowered.collection, block: lowered.block, path: lowered.segments ?? [] };
    if (isUndefined(desiredState) && !subtreeSatisfied(later, subtree)) {
      refuseUnrunnable(meta, subject, `its switched \`${lowered.attribute}\` state`);
    }
    return skipStamp(meta, `${subject} is absent and the switch is satisfied`);
  }
  if (isUndefined(target)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot materialize its target state`,
      body: [
        `Neither \`to\` nor the desired schema states where \`${lowered.attribute}\` lands.`,
        'Set `to`, or add the field to the schema.',
      ],
      path: meta.file,
    });
  }
  if (live !== 'unknown' && live !== lowered.from) {
    return skipStamp(meta, `${subject} already holds \`${lowered.attribute}: ${String(live)}\``);
  }
  if (target === lowered.from) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches \`${lowered.attribute}\` onto its own state`,
      body: [
        `Both sides resolve to \`${lowered.attribute}: ${String(target)}\` - the desired schema never flips it.`,
        'Flip the field in the schema, or delete the migration.',
      ],
      path: meta.file,
    });
  }
  if (lowered.attribute === 'translatable') {
    if (lowered.from) {
      if (isUndefined(lowered.column)) {
        await runFanInDerived(engine, meta, lowered);
      } else {
        await runFanInScalar(engine, meta, lowered);
      }
      return { name: meta.name, status: 'applied' };
    }
    if (!isUndefined(lowered.transform)) {
      if (isUndefined(lowered.column)) {
        throw ohneError({
          title: `Migration \`${meta.name}\` reshapes a composite fan-out`,
          body: [
            'An off -> on composite flip only stamps its rows onto the default locale; there is no value to reshape.',
            'Drop the transform.',
          ],
          path: meta.file,
        });
      }
      await runFanOutScalar(engine, meta, lowered);
    }
    // Without a transform the automatic fan-out performs the flip; the migration asserted the states.
    return { name: meta.name, status: 'applied' };
  }
  await runValuePass(engine, meta, lowered);
  return { name: meta.name, status: 'applied' };
}

/**
 * The desired side of a switch: what the schema says about the flipped attribute, if it says anything.
 * `translatable` reads from the column's desired home or the derived table's `_localeCode`.
 * `nullable` reads the column's `notNull`; the unique switches scan the home table's uniques.
 */
function desiredSwitchState(engine: Engine, lowered: LoweredSwitch): boolean | undefined {
  if (lowered.attribute === 'translatable') {
    const collection = lowered.collection as string;
    const segments = lowered.segments as readonly string[];
    const derived = engine.desired.find(
      (table) =>
        table.name === derivedTableName(collection, ...(segments as [string, ...string[]])),
    );
    if (!isUndefined(derived)) {
      return derived.columns.some((column) => column.name === '_localeCode');
    }
    const home = desiredHomeOf(engine, lowered);
    if (isUndefined(home)) return undefined;
    return !isUndefined(home.table.companion);
  }
  const home = desiredHomeOf(engine, lowered);
  if (isUndefined(home)) return undefined;
  const column = lowered.column as string;
  if (lowered.attribute === 'nullable') return !home.column.notNull;
  const scoped = home.table.uniques.some((unique) =>
    deepEqual(unique.columns, ['_localeCode', column]),
  );
  if (lowered.attribute === 'uniquePerLocale') return scoped;
  return scoped || home.table.uniques.some((unique) => deepEqual(unique.columns, [column]));
}

/**
 * The desired table and column a switch's field lands on: the field-path table, or the companion.
 * A dotted path homes on its prefix's derived table, exactly as the address lowering reads it.
 * A block-rooted switch homes on the per-type table's path; blocks never own a companion.
 */
function desiredHomeOf(
  engine: Engine,
  lowered: LoweredSwitch,
): { table: TableSchema; column: ColumnSchema } | undefined {
  const column = lowered.column ?? last(lowered.segments ?? []);
  if (isUndefined(column)) return undefined;
  const owner = switchOwner(lowered);
  const tables = isUndefined(owner)
    ? [engine.desired.find((table) => table.name === lowered.table)]
    : [
        engine.desired.find((table) => table.name === fieldPathTable(owner, lowered.segments)),
        lowered.segments?.length === 1 && !isUndefined(owner.collection)
          ? engine.desired.find((table) => table.companion === owner.collection)
          : undefined,
      ];
  for (const table of tables) {
    const found = table?.columns.find((item) => item.name === column);
    if (!isUndefined(table) && !isUndefined(found)) return { table, column: found };
  }
  return undefined;
}

/**
 * The logical owner of a switch's field, or nothing on a physically addressed switch.
 */
function switchOwner(lowered: LoweredSwitch): DerivedOwner | undefined {
  if (!isUndefined(lowered.collection)) return { collection: lowered.collection };
  if (!isUndefined(lowered.block)) return { block: lowered.block };
  return undefined;
}

/**
 * The table a field path's column sits on: the owner's root table, or the dotted prefix's derived table.
 */
function fieldPathTable(owner: DerivedOwner, segments: readonly string[] | undefined): string {
  const prefix = segments?.slice(0, -1) ?? [];
  if (isEmpty(prefix)) return ownerTableName(owner);
  return derivedTableName(derivedRootName(owner), prefix[0] as string, ...prefix.slice(1));
}

/**
 * The live side of a switch: the flipped attribute's current state, when it can be read at all.
 * `undefined` means the field is live nowhere.
 * `'unknown'` marks a live column whose unique state is unreadable under the sync bracket.
 * Every unique is already dropped there, so the pass simply runs.
 */
async function liveSwitchState(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
): Promise<boolean | 'unknown' | undefined> {
  if (lowered.attribute === 'translatable') {
    const collection = lowered.collection as string;
    const segments = lowered.segments as readonly string[];
    const derivedName = derivedTableName(collection, ...(segments as [string, ...string[]]));
    if (present(engine, derivedName)) {
      const derived = await describe(engine, derivedName);
      return derived.columns.some((column) => column.name === '_localeCode');
    }
    const column = last(segments) as string;
    const companionName = companionTableName(collection);
    if (engine.claimed[companionName]?.companion === collection && present(engine, companionName)) {
      const companion = await describe(engine, companionName);
      if (companion.columns.some((item) => item.name === column)) return true;
    }
    const main = collectionTableName(collection);
    if (segments.length === 1 && present(engine, main)) {
      const schema = await describe(engine, main);
      if (schema.columns.some((item) => item.name === column)) return false;
    }
    return undefined;
  }
  if (!present(engine, lowered.table)) return undefined;
  const schema = await describe(engine, lowered.table);
  const column = schema.columns.find((item) => item.name === lowered.column);
  if (isUndefined(column)) return undefined;
  if (!isUndefined(lowered.type)) {
    assertColumnMatches(
      engine,
      meta,
      { table: lowered.table, column: lowered.column as string, type: lowered.type },
      column,
    );
  }
  if (lowered.attribute === 'nullable') return !column.notNull;
  return 'unknown';
}

/**
 * Runs an off -> on scalar flip with its transform: each entity's value reshapes on its way over.
 * The mechanics mirror the automatic fan-out; the transform sees the value, the row, and no locale.
 * Returning nothing keeps the value; `deleteRecord()` has no row to delete yet and refuses.
 */
async function runFanOutScalar(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
): Promise<void> {
  const { db, dialect } = engine;
  const collection = lowered.collection as string;
  const column = lowered.column as string;
  const wanted = engine.desired.find((table) => table.companion === collection);
  if (isUndefined(wanted)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot fan \`${collection}.${column}\` out`,
      body: [
        'The desired schema holds no translations companion for the collection.',
        'Mark the field `translatable`, or fix the migration.',
      ],
      path: meta.file,
    });
  }
  const flip = wanted.columns.find((item) => item.name === column);
  if (isUndefined(flip)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot fan \`${collection}.${column}\` out`,
      body: [
        `The desired companion \`${wanted.name}\` holds no \`${column}\` column.`,
        'Mark the field `translatable` in the schema, or delete the migration.',
      ],
      path: meta.file,
    });
  }
  const main = collectionTableName(collection);
  const source = await describe(engine, main);
  const sourceColumn = source.columns.find((item) => item.name === column) as ColumnSchema;
  const rows = await readRows(engine, source);
  const companion = await ensureCompanion(engine, wanted, [flip]);
  const ctx = switchContext(engine, undefined);
  const update =
    `UPDATE ${dialect.quote(companion.name)} SET ${dialect.quote(column)} = ? ` +
    `WHERE ${dialect.quote('_parentUUID')} = ? AND ${dialect.quote('_localeCode')} = ?`;
  const insert =
    `INSERT INTO ${dialect.quote(companion.name)} ` +
    `(${dialect.quote('_parentUUID')}, ${dialect.quote('_localeCode')}, ${dialect.quote(column)}) ` +
    `VALUES (?, ?, ?)`;
  for (const row of rows) {
    const value = dialect.deserialize(sourceColumn.type, row[column] ?? null);
    const out = await applySwitchTransform(
      meta,
      lowered.transform,
      value,
      source,
      row,
      ctx,
      engine,
    );
    if (out === DELETE_RECORD) {
      throw ohneError({
        title: `Migration \`${meta.name}\` deletes on a fan-out`,
        body: [
          'A fan-out reshapes values on their way to the default locale; no locale row exists to delete yet.',
          'Return a value, or nothing to keep it.',
        ],
        path: meta.file,
      });
    }
    const serialized = dialect.serialize(flip.type, isUndefined(out) ? value : out);
    const parent = row.UUID ?? null;
    const { changes } = await db.run(update, [serialized, parent, engine.defaultLocale]);
    if (changes === 0 && !isNull(serialized)) {
      await db.run(insert, [parent, engine.defaultLocale, serialized]);
    }
  }
  const fresh = await describe(engine, main);
  const dropped = fresh.columns.find((item) => item.name === column);
  if (!isUndefined(dropped)) await dropColumn(engine, fresh, dropped);
  delete engine.claimed[main]?.columns[column];
}

/**
 * Runs an on -> off scalar flip: the fan-in resolves every (entity, locale) row of the companion.
 *
 * The transform promotes a value onto the entity's main column, skips, or deletes the whole row.
 * Without one the default locale promotes and the other locales keep their rows.
 * A transform-less flip that retypes at the same time refuses: values cannot carry across types raw.
 * Two promotions for one entity refuse by name - never a silent last-wins.
 * A `NOT NULL` main column probes early.
 * An entity that promoted nothing refuses here, naming the migration instead of aborting mid-apply.
 * The companion column then drops.
 * The whole companion goes instead when it held the last translatable field and desired omits it.
 */
async function runFanInScalar(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
): Promise<void> {
  const { db, dialect } = engine;
  const collection = lowered.collection as string;
  const column = lowered.column as string;
  const companionName = lowered.table;
  const schema = await describe(engine, companionName);
  const sourceColumn = schema.columns.find((item) => item.name === column) as ColumnSchema;
  const main = collectionTableName(collection);
  if (!present(engine, main)) refuseForeign(meta, main);
  let mainSchema = await describe(engine, main);
  const wantedColumn = engine.desired
    .find((table) => table.name === main)
    ?.columns.find((item) => item.name === column);
  const targetType = wantedColumn?.type ?? sourceColumn.type;
  if (
    isUndefined(lowered.transform) &&
    dialect.columnType(sourceColumn.type) !== dialect.columnType(targetType)
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` retypes \`${collection}.${column}\` untransformed`,
      body: [
        `The companion holds \`${sourceColumn.type}\` and the main column wants \`${targetType}\`; values cannot carry across types raw.`,
        'Attach a transform returning the new type, or align the types.',
      ],
      path: meta.file,
    });
  }
  if (!mainSchema.columns.some((item) => item.name === column)) {
    mainSchema = await addColumn(engine, mainSchema, {
      name: column,
      type: targetType,
      notNull: false,
    });
    setClaim(engine, main, column, targetType);
  }
  const rows = await readRows(engine, schema);
  const update = `UPDATE ${dialect.quote(main)} SET ${dialect.quote(column)} = ? WHERE ${dialect.quote('UUID')} = ?`;
  const erase =
    `DELETE FROM ${dialect.quote(companionName)} ` +
    `WHERE ${dialect.quote('_parentUUID')} = ? AND ${dialect.quote('_localeCode')} = ?`;
  const promoted = new Set<string>();
  let unmatched = 0;
  for (const row of rows) {
    const locale = String(row._localeCode);
    const parent = row._parentUUID ?? null;
    const value = dialect.deserialize(sourceColumn.type, row[column] ?? null);
    const ctx = switchContext(engine, locale);
    const out = isUndefined(lowered.transform)
      ? locale === engine.defaultLocale
        ? value
        : undefined
      : await applySwitchTransform(meta, lowered.transform, value, schema, row, ctx, engine);
    if (out === DELETE_RECORD) {
      await db.run(erase, [parent, locale]);
      continue;
    }
    if (isUndefined(out)) continue;
    if (promoted.has(String(parent))) {
      throw ohneError({
        title: `Migration \`${meta.name}\` promotes two values for one entity`,
        body: [
          `\`${String(parent)}\` of \`${main}\` received a second promoted value, from locale \`${locale}\`.`,
          'Return a value once per entity; the other locales return nothing or `deleteRecord()`.',
        ],
        path: meta.file,
      });
    }
    promoted.add(String(parent));
    const { changes } = await db.run(update, [dialect.serialize(targetType, out), parent]);
    if (changes === 0) unmatched++;
  }
  if (unmatched > 0) {
    if (!engine.force) {
      throw ohneError({
        title: `Migration \`${meta.name}\` cannot map every row`,
        body: [
          `\`${unmatched}\` ${pluralize(unmatched, 'row')} of \`${companionName}\` ${unmatched === 1 ? 'has' : 'have'} no \`${main}\` row to receive ${unmatched === 1 ? 'its' : 'their'} \`${column}\` value.`,
          '',
          'Create the missing rows, or set `FORCE_SYNC` or `database.sync.force` to drop these values for one boot.',
        ],
        path: meta.file,
      });
    }
    engine.deletions.push(
      `- \`${unmatched}\` \`${companionName}.${column}\` ${pluralize(unmatched, 'value')} had no \`${main}\` row to promote onto`,
    );
  }
  if (wantedColumn?.notNull === true) {
    const row = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(main)} ` +
        `WHERE ${dialect.quote(column)} IS NULL`,
    );
    if ((row?.count ?? 0) > 0) {
      throw ohneError({
        title: `Migration \`${meta.name}\` leaves \`${row?.count}\` ${pluralize(row?.count ?? 0, 'entity', 'entities')} without a value`,
        body: [
          `\`${main}.${column}\` is \`NOT NULL\`, and ${(row?.count ?? 0) === 1 ? 'this entity' : 'these entities'} promoted nothing from any locale.`,
          'Return a value for one locale of each entity, or relax the column.',
        ],
        path: meta.file,
      });
    }
  }
  const fresh = await describe(engine, companionName);
  const users = fresh.columns.filter((item) => !item.name.startsWith('_'));
  const desiredOmits = engine.desired.every((table) => table.name !== companionName);
  if (desiredOmits && users.length === 1 && users[0]?.name === column) {
    await dropOwnedTable(engine, companionName);
    return;
  }
  const dropped = fresh.columns.find((item) => item.name === column);
  if (!isUndefined(dropped)) await dropColumn(engine, fresh, dropped);
  delete engine.claimed[companionName]?.columns[column];
}

/**
 * Runs an on -> off composite flip: the fan-in resolves every locale-scoped row of the derived table.
 * There is no main column, so the outcomes are keeping the row and deleting it; a value refuses.
 * Without a transform the default locale's rows survive and every other locale's row dies.
 * Doomed rows die through the owned-row cascade, so nested children and block references follow.
 * `_localeCode` then drops; the diff narrows the uniques, and the guard aborts surplus survivors.
 */
async function runFanInDerived(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
): Promise<void> {
  const schema = await describe(engine, lowered.table);
  const rows = await readRows(engine, schema);
  const doomed: Record<string, SQLValue>[] = [];
  for (const row of rows) {
    const locale = String(row._localeCode);
    const ctx = switchContext(engine, locale);
    const out = isUndefined(lowered.transform)
      ? locale === engine.defaultLocale
        ? undefined
        : DELETE_RECORD
      : await applySwitchTransform(meta, lowered.transform, undefined, schema, row, ctx, engine);
    if (out === DELETE_RECORD) {
      doomed.push(row);
      continue;
    }
    if (!isUndefined(out)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` promotes a value from a composite`,
        body: [
          'A composite fan-in keeps or deletes rows; there is no main column to promote onto.',
          'Return nothing to keep the row, or `deleteRecord()`.',
        ],
        path: meta.file,
      });
    }
  }
  await deleteOwnedRows(engine, schema, doomed);
  const fresh = await describe(engine, lowered.table);
  const dropped = fresh.columns.find((item) => item.name === '_localeCode');
  if (!isUndefined(dropped)) await dropColumn(engine, fresh, dropped);
  delete engine.claimed[lowered.table]?.columns._localeCode;
}

/**
 * Runs a `nullable` or unique switch's transform once per row, rewriting values in place.
 * The structural change stays with the diff, whose guard probes then pass over the massaged data.
 * `deleteRecord()` resolves a duplicate by dropping its row through the owned-row cascade.
 * Junction and record references aimed at a deleted row surface on the next sync's orphan probe.
 * Without a transform nothing runs.
 */
async function runValuePass(
  engine: Engine,
  meta: MigrationMeta,
  lowered: LoweredSwitch,
): Promise<void> {
  if (isUndefined(lowered.transform)) return;
  const { db, dialect } = engine;
  const column = lowered.column as string;
  const schema = await describe(engine, lowered.table);
  const columnDef = schema.columns.find((item) => item.name === column) as ColumnSchema;
  assertNotPrimaryKey(meta, schema, { table: lowered.table, column, type: columnDef.type });
  if (isEmpty(schema.primaryKey)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot correlate rows`,
      body: [`\`${lowered.table}\` has no primary key to correlate rows by.`],
      path: meta.file,
    });
  }
  const localeKeyed = schema.columns.some((item) => item.name === '_localeCode');
  const where = schema.primaryKey.map((name) => `${dialect.quote(name)} = ?`).join(' AND ');
  const update = `UPDATE ${dialect.quote(lowered.table)} SET ${dialect.quote(column)} = ? WHERE ${where}`;
  const rows = await readRows(engine, schema);
  const doomed: Record<string, SQLValue>[] = [];
  for (const row of rows) {
    const locale = localeKeyed ? String(row._localeCode) : undefined;
    const ctx = switchContext(engine, locale);
    const value = dialect.deserialize(columnDef.type, row[column] ?? null);
    const out = await applySwitchTransform(
      meta,
      lowered.transform,
      value,
      schema,
      row,
      ctx,
      engine,
    );
    if (out === DELETE_RECORD) {
      doomed.push(row);
      continue;
    }
    if (isUndefined(out)) continue;
    const key = schema.primaryKey.map((name) => row[name] ?? null);
    await db.run(update, [dialect.serialize(columnDef.type, out), ...key]);
  }
  await deleteOwnedRows(engine, schema, doomed);
}

/**
 * Deletes the given rows of one owned table, everything hanging off them following.
 *
 * The sync bracket runs with foreign keys off, so nothing cascades on its own.
 * A blocks wrapper first sweeps the instances only its doomed rows reference, reported like any purge.
 * Child tables, junctions, wrappers, and companions keyed to the deleted rows die next, recursively.
 * Rows of a per-type block table pull the wrapper rows referencing them along too.
 * The link is polymorphic, so no key would ever cascade it.
 * A junction row deletes by its link pair, plus `_localeCode` when the table carries it.
 * Every other table deletes by its primary key.
 */
async function deleteOwnedRows(
  engine: Engine,
  schema: TableSchema,
  doomed: readonly Record<string, SQLValue>[],
): Promise<void> {
  if (isEmpty(doomed)) return;
  const { db, dialect } = engine;
  const claim = engine.claimed[schema.name];
  const keyColumns = isEmpty(schema.primaryKey) ? junctionKeyColumns(schema) : schema.primaryKey;
  if (claim?.derived?.kind === 'blocksWrapper') {
    const universe: SweepTable[] = Object.entries(engine.claimed)
      .filter(([name]) => engine.names.has(name))
      .map(([name, item]) => ({ name, derived: item.derived, block: item.block }));
    const list = doomed.map((row) => `'${String(row.UUID).replaceAll("'", "''")}'`).join(', ');
    const condition = `${dialect.quote(schema.name)}.${dialect.quote('UUID')} IN (${list})`;
    engine.deletions.push(
      ...(await sweepWrapperRows(db, dialect, universe, schema.name, condition)),
    );
  }
  const where = keyColumns.map((name) => `${dialect.quote(name)} = ?`).join(' AND ');
  const erase = `DELETE FROM ${dialect.quote(schema.name)} WHERE ${where}`;
  for (const row of doomed) {
    await db.run(
      erase,
      keyColumns.map((name) => row[name] ?? null),
    );
  }
  const parents = doomed.flatMap((row) => (isUndefined(row.UUID) ? [] : [row.UUID as SQLValue]));
  if (isEmpty(parents)) return;
  const block = claim?.block;
  if (!isUndefined(block)) {
    for (const [name, item] of Object.entries(engine.claimed)) {
      if (item.derived?.kind !== 'blocksWrapper' || !engine.names.has(name)) continue;
      let removed = 0;
      for (const batch of chunk(parents, 500)) {
        const marks = batch.map(() => '?').join(', ');
        const { changes } = await db.run(
          `DELETE FROM ${dialect.quote(name)} WHERE ${dialect.quote('_blockType')} = ? ` +
            `AND ${dialect.quote('_blockUUID')} IN (${marks})`,
          [block, ...batch],
        );
        removed += changes;
      }
      if (removed === 0) continue;
      engine.deletions.push(
        `- \`${removed}\` ${pluralize(removed, 'row')} of \`${name}\` deleted, referencing deleted \`${schema.name}\` rows`,
      );
    }
  }
  for (const [name, child] of Object.entries(engine.claimed)) {
    if (!engine.names.has(name)) continue;
    const under =
      (!isUndefined(child.derived) && derivedParentName(child.derived) === schema.name) ||
      (!isUndefined(child.companion) && collectionTableName(child.companion) === schema.name);
    if (!under) continue;
    const childSchema = await describe(engine, name);
    const orphaned: Record<string, SQLValue>[] = [];
    for (const batch of chunk(parents, 500)) {
      const marks = batch.map(() => '?').join(', ');
      orphaned.push(
        ...(await db.query<Record<string, SQLValue>>(
          `SELECT * FROM ${dialect.quote(name)} WHERE ${dialect.quote('_parentUUID')} IN (${marks})`,
          batch,
        )),
      );
    }
    if (isEmpty(orphaned)) continue;
    engine.deletions.push(
      `- \`${orphaned.length}\` ${pluralize(orphaned.length, 'row')} of \`${name}\` deleted, following ${orphaned.length === 1 ? 'its deleted parent' : 'their deleted parents'}`,
    );
    await deleteOwnedRows(engine, childSchema, orphaned);
  }
}

/**
 * The delete key for a keyless junction row: the link pair, with `_localeCode` only when the table has it.
 * A plain junction carries no locale column; a translatable one scopes each link per locale.
 */
function junctionKeyColumns(schema: TableSchema): string[] {
  const key = ['_parentUUID', '_targetUUID'];
  return schema.columns.some((column) => column.name === '_localeCode')
    ? [...key, '_localeCode']
    : key;
}

/**
 * One `ctx` query opened by a transform, tracking whether its result was ever awaited.
 */
interface TrackedQuery {
  awaited: boolean;
}

/**
 * The `ctx` queries opened through each migration context, for the unawaited-query guard.
 */
const contextQueries = new WeakMap<MigrationContext, TrackedQuery[]>();

/**
 * Wraps a `ctx` query result so the guard can tell whether the transform awaited it.
 * Awaiting or `.then`-ing it marks it consumed; reading a property off it (a forgotten `await`) does not.
 * The inner rejection is swallowed on the untaken path, so a never-awaited query cannot warn unhandled.
 */
function trackQuery<T>(inner: Promise<T>, tracked: TrackedQuery[]): Promise<T> {
  const marker: TrackedQuery = { awaited: false };
  tracked.push(marker);
  inner.catch(() => undefined);
  const guarded: PromiseLike<T> & Pick<Promise<T>, 'catch' | 'finally'> = {
    // oxlint-disable-next-line no-thenable
    then: (onFulfilled, onRejected) => (
      (marker.awaited = true),
      inner.then(onFulfilled, onRejected)
    ),
    catch: (onRejected) => ((marker.awaited = true), inner.catch(onRejected)),
    finally: (onFinally) => ((marker.awaited = true), inner.finally(onFinally)),
  };
  return guarded as Promise<T>;
}

/**
 * The transform context of one switch row: read-only queries, the locale in hand, and the sentinel.
 * Each query is tracked, so a result used without `await` is caught rather than read as `undefined`.
 */
function switchContext(engine: Engine, locale: string | undefined): MigrationContext {
  const { db } = engine;
  const tracked: TrackedQuery[] = [];
  const ctx: MigrationContext = {
    query: <T>(sql: string, params?: SQLParams) => trackQuery(db.query<T>(sql, params), tracked),
    queryOne: <T>(sql: string, params?: SQLParams) =>
      trackQuery(db.queryOne<T>(sql, params), tracked),
    ...(isUndefined(locale) ? {} : { locale }),
    deleteRecord: () => DELETE_RECORD,
  };
  contextQueries.set(ctx, tracked);
  return ctx;
}

/**
 * Refuses a transform that opened a `ctx` query without awaiting it.
 * Such a call reads as `undefined` or a truthy object, so it would silently corrupt every row.
 */
function assertQueriesAwaited(meta: MigrationMeta, ctx: MigrationContext): void {
  const tracked = contextQueries.get(ctx);
  if (isUndefined(tracked) || tracked.every((query) => query.awaited)) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` did not \`await\` a \`ctx\` query`,
    body: [
      'A `ctx.query` or `ctx.queryOne` result is a `Promise`.',
      'Used without `await` it reads as `undefined` or a truthy object, silently corrupting the transform.',
      'Await it, for example `const row = await ctx.queryOne(...)`.',
    ],
    path: meta.file,
  });
}

/**
 * Invokes a switch transform on one row, wrapping a throw into an error naming the migration.
 */
async function applySwitchTransform(
  meta: MigrationMeta,
  transform: MigrationTransform | undefined,
  value: unknown,
  schema: TableSchema,
  row: Record<string, SQLValue>,
  ctx: MigrationContext,
  engine: Engine,
): Promise<unknown> {
  if (isUndefined(transform)) return undefined;
  let out: unknown;
  try {
    out = await transform(value, deserializeRow(engine.dialect, schema, row), ctx);
  } catch (error) {
    throw ohneError({
      title: `Migration \`${meta.name}\` fails in its transform`,
      body: [errorMessage(error), '', `Thrown for a \`${schema.name}\` row; fix the transform.`],
      path: meta.file,
    });
  }
  assertQueriesAwaited(meta, ctx);
  return out;
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
 * A throwing transform and a `NULL` bound for a `NOT NULL` column refuse, naming the migration.
 * A parent moving onto its child-one table with no child row yet inserts a fresh one.
 * So nesting a column into a newly added object materializes the child rows instead of refusing.
 * A translatable child-one stamps the fresh row at the default locale, as a composite flip does.
 * Any other cross-table row with no target row loses its value when `from` drops: refused unless force.
 * Force drops those values and reports them.
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
  if (isEmpty(rows)) return;
  const notNull = target.columns.find((column) => column.name === to.column)?.notNull === true;
  const where = targetKey.map((name) => `${dialect.quote(name)} = ?`).join(' AND ');
  const update = `UPDATE ${dialect.quote(to.table)} SET ${dialect.quote(to.column)} = ? WHERE ${where}`;
  const insertsChild =
    target.derived?.kind === 'childOne' && targetKey.length === 1 && targetKey[0] === '_parentUUID';
  const stampsLocale =
    insertsChild && target.columns.some((column) => column.name === '_localeCode');
  const insertColumns = [
    'UUID',
    '_parentUUID',
    ...(stampsLocale ? ['_localeCode'] : []),
    to.column,
  ];
  const insert = insertsChild
    ? `INSERT INTO ${dialect.quote(to.table)} ` +
      `(${insertColumns.map((name) => dialect.quote(name)).join(', ')}) ` +
      `VALUES (${insertColumns.map(() => '?').join(', ')})`
    : undefined;
  const localeKeyed = source.columns.some((column) => column.name === '_localeCode');
  let unmatched = 0;
  for (const row of rows) {
    const ctx = switchContext(engine, localeKeyed ? String(row._localeCode) : undefined);
    const value = dialect.deserialize(from.type, row[from.column] ?? null);
    let output = value;
    if (!isUndefined(transform)) {
      try {
        output = await transform(value, deserializeRow(dialect, source, row), ctx);
      } catch (error) {
        throw ohneError({
          title: `Migration \`${meta.name}\` fails in its transform`,
          body: [errorMessage(error), '', `Thrown for a \`${from.table}\` row; fix the transform.`],
          path: meta.file,
        });
      }
      assertQueriesAwaited(meta, ctx);
    }
    if (output === DELETE_RECORD) {
      throw ohneError({
        title: `Migration \`${meta.name}\` deletes on a move`,
        body: [
          "A move carries values onto their new column; deleting rows is the switch fan-in's tool.",
          'Return a value, or make the migration a switch.',
        ],
        path: meta.file,
      });
    }
    const serialized = dialect.serialize(to.type, output);
    if (isNull(serialized) && notNull) {
      throw ohneError({
        title: `Migration \`${meta.name}\` moves \`NULL\` into a \`NOT NULL\` column`,
        body: [
          `\`${from.table}.${from.column}\` holds \`NULL\` values, and \`${to.table}.${to.column}\` refuses them.`,
          'Return a fallback from a `transform`, or relax the column.',
        ],
        path: meta.file,
      });
    }
    const params = [serialized, ...sourceKey.map((name) => row[name] ?? null)];
    const { changes } = await db.run(update, params);
    if (changes > 0) continue;
    if (!isUndefined(insert)) {
      const anchor = row[sourceKey[0] as string] ?? null;
      await db.run(
        insert,
        stampsLocale
          ? [uuidv7(), anchor, engine.defaultLocale, serialized]
          : [uuidv7(), anchor, serialized],
      );
      continue;
    }
    unmatched++;
  }
  if (unmatched === 0) return;
  if (!engine.force) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot map every row`,
      body: [
        `\`${unmatched}\` ${pluralize(unmatched, 'row')} of \`${from.table}\` ${unmatched === 1 ? 'has' : 'have'} no \`${to.table}\` row to receive ${unmatched === 1 ? 'its' : 'their'} \`${from.column}\` value.`,
        '',
        'Create the missing rows, or set `FORCE_SYNC` or `database.sync.force` to drop these values for one boot.',
      ],
      path: meta.file,
    });
  }
  engine.deletions.push(
    `- \`${unmatched}\` \`${from.table}.${from.column}\` ${pluralize(unmatched, 'value')} had no \`${to.table}\` row to move onto`,
  );
}

/**
 * Resolves how source rows map onto target rows, pinned by table classification.
 *
 * Within one table, the row is its own target, keyed by the primary key.
 * A child table moving onto its parent joins `_parentUUID = UUID`.
 * A parent moving onto its child-one table joins the other way around.
 * A junction, child-many, or blocks-wrapper table holds many rows per parent: no row mapping exists.
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
    if (!isUndefined(sourceOrigin) && derivedParentName(sourceOrigin) === target.name) {
      if (sourceOrigin.kind !== 'childOne') refuseManyRows(meta, source.name, target.name);
      return { sourceKey: ['_parentUUID'], targetKey: ['UUID'] };
    }
    const targetOrigin = engine.claimed[target.name]?.derived;
    if (!isUndefined(targetOrigin) && derivedParentName(targetOrigin) === source.name) {
      if (targetOrigin.kind !== 'childOne') refuseManyRows(meta, target.name, source.name);
      return { sourceKey: ['UUID'], targetKey: ['_parentUUID'] };
    }
  }
  if (isEmpty(source.primaryKey)) {
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
 * The refusal for a move touching a many-rows-per-parent table across tables: no single row wins.
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
 * Whether a later logical `from` consumes the whole subtree a logical `to` sits under.
 * No physical name can line up there: a collection-level `from` enumerates its family only at run time.
 * A `to` on one of its derived tables therefore satisfies through the subtree instead.
 * An empty consumed path covers the whole collection.
 */
function subtreeSatisfied(
  later: readonly ConsumedAddress[],
  subtree: LogicalSubtree | undefined,
): boolean {
  if (isUndefined(subtree)) return false;
  return later.some(
    (consumed) =>
      !isUndefined(consumed.subtree) &&
      consumed.subtree.collection === subtree.collection &&
      consumed.subtree.block === subtree.block &&
      pathStartsWith(subtree.path, consumed.subtree.path),
  );
}

/**
 * Whether a rename's target is already realized: live and owned, desired, or consumed by a later `from`.
 */
function tableSatisfied(engine: Engine, table: string, later: readonly ConsumedAddress[]): boolean {
  if (present(engine, table)) return true;
  if (engine.desired.some((schema) => schema.name === table)) return true;
  return later.some((consumed) => consumed.table === table);
}

/**
 * Whether a move's target column is already realized: live, desired, or consumed by a later `from`.
 * A later whole-table `from` counts, since it consumes every column on it.
 */
async function columnSatisfied(
  engine: Engine,
  address: ColumnAddress,
  later: readonly ConsumedAddress[],
): Promise<boolean> {
  if (present(engine, address.table)) {
    const schema = await describe(engine, address.table);
    if (schema.columns.some((column) => column.name === address.column)) return true;
  }
  const wanted = engine.desired.find((table) => table.name === address.table);
  if (!isUndefined(wanted) && wanted.columns.some((column) => column.name === address.column)) {
    return true;
  }
  return later.some(
    (consumed) =>
      consumed.table === address.table &&
      (isUndefined(consumed.column) || consumed.column === address.column),
  );
}

/**
 * A drifted `from` or `to` is a hard error naming the mismatch, never a silent skip.
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
 * The hard refusal for a `from` that is absent while `to` is nowhere: a stale or mistyped migration.
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
