import type { Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type { SweepTable } from './purge.ts';
import type {
  ForeignKeySchema,
  IndexSchema,
  TableAlter,
  TableDiff,
  TableSchema,
} from './table-schema.ts';

import { isUndefined, keyBy, pluralize } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { clearSQL, danglingCondition, deleteSQL, purgedLine, sweepWrapperRows } from './purge.ts';

/**
 * Guard behavior switches.
 */
export interface GuardOptions {
  /**
   * Authorizes destructive findings for this run and performs the purges they report.
   * Duplicate-unique and NULL-over-NOT-NULL findings stay refusals - force cannot pick winners.
   * A cardinality collapse is the exception: its winner is pinned to each parent's first row.
   */
  force: boolean;
}

/**
 * What a schema sync destroyed, and the orphan rows it left in place.
 */
export interface GuardReport {
  /**
   * One line per dropped table, dropped or retyped column, and purge of rows or values, ready to print.
   */
  deletions: string[];

  /**
   * Non-fatal notices: pre-existing orphan rows left in place without force.
   */
  warnings: string[];
}

interface DanglingFinding {
  table: string;
  foreignKey: ForeignKeySchema;
  count: number;
  targetCreated: boolean;
}

interface CollapseFinding {
  table: string;
  groups: number;
}

interface DisallowedFinding {
  table: string;
  type: string;
  count: number;
  allowed: readonly string[];
}

interface Findings {
  losses: string[];
  blockLosses: string[];
  purgeable: DanglingFinding[];
  collapses: CollapseFinding[];
  disallowed: DisallowedFinding[];
  blockers: string[];
  orphans: DanglingFinding[];
}

/**
 * The destructive guard: probes every diff and refuses what would silently lose data.
 * A populated table or column drop and a populated retype refuse unless `force` authorizes them.
 * A new unique over duplicates or `NOT NULL` over NULLs refuses regardless - force cannot pick winners.
 * A repeater collapsing to one row per parent is the exception, since its winner is pinned.
 * Force keeps each parent's first row - lowest `_parentPosition`, `UUID` breaking ties - and drops the rest.
 * Rows dangling under a foreign key being added refuse too; under force they are purged here.
 * Pre-existing orphans under a surviving foreign key only warn; under force they are purged as well.
 * A purge clears the dangling values where the column permits `NULL` both live and desired.
 * Everywhere else it deletes the rows: a `record` reference clears, a junction row vanishes.
 * Purges run to a fixed point: rows orphaned by a deletion are purged and reported too, `live`-wide.
 *
 * Wrapper rows holding a block type outside their field's `allow` refuse too.
 * A type removal and an allow-list shrink surface as that same finding.
 * Under force those rows are deleted, and the block instances only they referenced sweep with them.
 * A loss on a `block_` per-type table or a disallowed block row has no migration to point at.
 * Their refusal therefore names force alone.
 *
 * Every finding lands in one error block; probes run before any mutation, so a re-add cannot explode.
 */
export async function guardDiffs(
  db: Transaction,
  dialect: Dialect,
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
  desired: readonly TableSchema[],
  options: GuardOptions,
): Promise<GuardReport> {
  const findings: Findings = {
    losses: [],
    blockLosses: [],
    purgeable: [],
    collapses: [],
    disallowed: [],
    blockers: [],
    orphans: [],
  };
  const creating = new Set(
    diffs.flatMap((diff) => (diff.kind === 'create' ? [diff.table.name] : [])),
  );
  for (const diff of diffs) {
    if (diff.kind === 'create') continue;
    if (diff.kind === 'drop') {
      const rows = await countRows(db, dialect, diff.table.name);
      if (rows === 0) continue;
      const losses = blockOwned(diff.table) ? findings.blockLosses : findings.losses;
      losses.push(`- table \`${diff.table.name}\` (\`${rows}\` ${pluralize(rows, 'row')})`);
      continue;
    }
    await guardAlter(db, dialect, diff, creating, findings);
  }
  await probeDisallowed(db, dialect, live, desired, findings);
  const migratable = [
    ...findings.losses,
    ...findings.purgeable.map((item) => danglingLine(item.table, item.foreignKey, item.count)),
    ...findings.collapses.map((item) => collapseLine(item.table, item.groups)),
  ];
  const blockGrade = [
    ...findings.blockLosses,
    ...findings.disallowed.map((item) => disallowedLine(item.table, item.type, item.count)),
  ];
  if (
    findings.blockers.length > 0 ||
    ((migratable.length > 0 || blockGrade.length > 0) && !options.force)
  ) {
    throw ohneError({
      title: 'Destructive sync refused',
      body: refusalBody(migratable, blockGrade, findings.blockers),
    });
  }
  if (!options.force) {
    return {
      deletions: [],
      warnings: findings.orphans.map((orphan) =>
        danglingLine(orphan.table, orphan.foreignKey, orphan.count),
      ),
    };
  }
  const purged = await purgeDangling(db, dialect, findings, diffs, live, desired);
  return {
    deletions: [...findings.losses, ...findings.blockLosses, ...purged],
    warnings: [],
  };
}

/**
 * Probes one alter's columns, uniques, primary key, and foreign keys, pushing findings by grade.
 * Structure arriving in this sync is never probed against the live table.
 * A just-added column holds no values, so nothing over it can collide or dangle.
 * A foreign key to a table created this sync makes every non-NULL value dangle by definition.
 * A detected cardinality collapse absorbs its `_parentPosition` drop: ordering is structure, not data.
 * A value loss on a block-owned table grades block: no migration can address it in place.
 */
async function guardAlter(
  db: Transaction,
  dialect: Dialect,
  alter: TableAlter,
  creating: ReadonlySet<string>,
  findings: Findings,
): Promise<void> {
  const table = alter.desired.name;
  const losses = blockOwned(alter.live) ? findings.blockLosses : findings.losses;
  const added = new Set(alter.addColumns.map((column) => column.name));
  const collapse = detectCollapse(alter);
  const rows = await countRows(db, dialect, table);
  for (const column of alter.dropColumns) {
    if (!isUndefined(collapse) && column.name === '_parentPosition') continue;
    const values = await countWhere(
      db,
      dialect,
      table,
      `${dialect.quote(column.name)} IS NOT NULL`,
    );
    if (values > 0) {
      losses.push(
        `- column \`${table}.${column.name}\` (\`${values}\` ${pluralize(values, 'value')})`,
      );
    }
  }
  for (const change of alter.changeColumns) {
    const name = change.desired.name;
    const retyped =
      dialect.columnType(change.live.type) !== dialect.columnType(change.desired.type);
    if (retyped && change.desired.notNull && rows > 0) {
      findings.blockers.push(
        `- column \`${table}.${name}\` retypes under NOT NULL, leaving \`${rows}\` ${pluralize(rows, 'row')} without a value`,
      );
      continue;
    }
    if (retyped) {
      const values = await countWhere(db, dialect, table, `${dialect.quote(name)} IS NOT NULL`);
      if (values > 0) {
        losses.push(
          `- column \`${table}.${name}\` (\`${values}\` ${pluralize(values, 'value')}, \`${change.live.type}\` -> \`${change.desired.type}\`)`,
        );
      }
    }
    if (!change.live.notNull && change.desired.notNull) {
      const nulls = await countWhere(db, dialect, table, `${dialect.quote(name)} IS NULL`);
      if (nulls > 0) {
        findings.blockers.push(
          `- column \`${table}.${name}\` becomes NOT NULL over \`${nulls}\` NULL ${pluralize(nulls, 'row')}`,
        );
      }
    }
  }
  if (rows > 0) {
    for (const column of alter.addColumns) {
      if (!column.notNull) continue;
      findings.blockers.push(
        `- new column \`${table}.${column.name}\` is NOT NULL but \`${table}\` holds \`${rows}\` ${pluralize(rows, 'row')}`,
      );
    }
  }
  for (const unique of alter.addUniques) {
    if (unique.columns.some((column) => added.has(column))) continue;
    const groups = await countDuplicateGroups(db, dialect, table, unique.columns);
    if (groups === 0) continue;
    if (unique === collapse) {
      findings.collapses.push({ table, groups });
      continue;
    }
    findings.blockers.push(
      `- unique \`${unique.name}\` covers \`${groups}\` duplicate ${pluralize(groups, 'group')}`,
    );
  }
  if (
    alter.changePrimaryKey &&
    alter.desired.primaryKey.length > 0 &&
    rows > 0 &&
    !alter.desired.primaryKey.some((column) => added.has(column))
  ) {
    const groups = await countDuplicateGroups(db, dialect, table, alter.desired.primaryKey);
    if (groups > 0) {
      const key = alter.desired.primaryKey.map((column) => `\`${column}\``).join(', ');
      findings.blockers.push(
        `- primary key over ${key} covers \`${groups}\` duplicate ${pluralize(groups, 'group')}`,
      );
    }
  }
  for (const foreignKey of alter.addForeignKeys) {
    if (added.has(foreignKey.column)) continue;
    const targetCreated = creating.has(foreignKey.targetTable);
    const dangling = targetCreated
      ? await countWhere(db, dialect, table, `${dialect.quote(foreignKey.column)} IS NOT NULL`)
      : await countDangling(db, dialect, table, foreignKey);
    if (dangling === 0) continue;
    findings.purgeable.push({ table, foreignKey, count: dangling, targetCreated });
  }
  const surviving = alter.live.foreignKeys.filter(
    (foreignKey) => !alter.dropForeignKeys.some((dropped) => dropped.column === foreignKey.column),
  );
  for (const foreignKey of surviving) {
    const dangling = await countDangling(db, dialect, table, foreignKey);
    if (dangling === 0) continue;
    findings.orphans.push({ table, foreignKey, count: dangling, targetCreated: false });
  }
}

/**
 * Probes every surviving wrapper for rows whose block type left the desired `allow` set.
 * A removed block type and a shrunk allow-list surface identically: the rows have nowhere to belong.
 * Runs off the live and desired schemas directly.
 * An allow-list shrink changes no structure, so no diff exists to hang the probe on.
 */
async function probeDisallowed(
  db: Transaction,
  dialect: Dialect,
  live: readonly TableSchema[],
  desired: readonly TableSchema[],
  findings: Findings,
): Promise<void> {
  const desiredByName = keyBy(desired, (table) => table.name);
  for (const table of live) {
    if (table.derived?.kind !== 'blocksWrapper') continue;
    if (!table.columns.some((column) => column.name === '_blockType')) continue;
    const wanted = desiredByName[table.name];
    if (wanted?.derived?.kind !== 'blocksWrapper') continue;
    const allowed = wanted.derived.allow ?? [];
    const rows = await db.query<{ type: string; count: number }>(
      `SELECT ${dialect.quote('_blockType')} AS ${dialect.quote('type')}, ` +
        `COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(table.name)}` +
        `${allowed.length > 0 ? ` WHERE ${disallowedCondition(dialect, table.name, allowed)}` : ''} ` +
        `GROUP BY ${dialect.quote('_blockType')}`,
    );
    for (const row of rows) {
      findings.disallowed.push({ table: table.name, type: row.type, count: row.count, allowed });
    }
  }
}

/**
 * The condition matching wrapper rows whose block type sits outside the allowed set.
 * Block names are validated PascalCase, so they inline as literals safely.
 */
function disallowedCondition(dialect: Dialect, table: string, allowed: readonly string[]): string {
  const list = allowed.map((name) => `'${name}'`).join(', ');
  return `${dialect.quote(table)}.${dialect.quote('_blockType')} NOT IN (${list})`;
}

/**
 * Executes the collapse, disallowed-block, and dangling purges to a fixed point.
 *
 * Wrappers leaving the schema - dropped, or reshaped into something else - sweep first.
 * The block instances only their rows referenced are deleted before the structure goes.
 * Disallowed wrapper rows sweep the same way, then delete.
 * A collapse deletes every row after each parent's first, before the dangling purges run.
 * A dangling value is cleared to `NULL` where the column permits it both live and desired.
 * Live governs because purges run before any structural apply; desired governs the end state.
 * Everywhere else the rows are deleted, a wrapper's block references sweeping ahead of the delete.
 * A deleted row can strand rows referencing it, on tables this sync never touched.
 * Every foreign key aiming at a purged table is therefore re-probed until a pass deletes nothing.
 * Clearing values orphans nothing, so only deletions feed the re-probe.
 * Returns one report line per executed purge, counting what it actually cleared or deleted.
 */
async function purgeDangling(
  db: Transaction,
  dialect: Dialect,
  findings: Findings,
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
  desired: readonly TableSchema[],
): Promise<string[]> {
  const lines: string[] = [];
  const universe = probeUniverse(diffs, live);
  const nullable = nullableColumns(diffs, live);
  const sweepable = sweepUniverse(diffs, live, desired);
  const wrappers = new Set(
    sweepable.flatMap((table) => (table.derived?.kind === 'blocksWrapper' ? [table.name] : [])),
  );
  for (const retired of retiredWrappers(live, desired)) {
    lines.push(...(await sweepWrapperRows(db, dialect, sweepable, retired)));
  }
  const disallowedByTable = new Map<string, readonly string[]>();
  for (const item of findings.disallowed) disallowedByTable.set(item.table, item.allowed);
  for (const [table, allowed] of disallowedByTable) {
    const doomed = disallowedCondition(dialect, table, allowed);
    lines.push(...(await sweepWrapperRows(db, dialect, sweepable, table, doomed)));
    const { changes } = await db.run(`DELETE FROM ${dialect.quote(table)} WHERE ${doomed}`);
    if (changes > 0) {
      lines.push(
        `- \`${changes}\` ${pluralize(changes, 'row')} of \`${table}\` deleted, holding blocks no longer allowed there`,
      );
    }
  }
  let queue = [...findings.purgeable, ...findings.orphans];
  let pending = [...findings.collapses];
  while (queue.length > 0 || pending.length > 0) {
    const affected = new Set<string>();
    for (const item of pending) {
      const { changes } = await db.run(collapseSQL(dialect, item.table));
      if (changes === 0) continue;
      lines.push(
        `- \`${changes}\` ${pluralize(changes, 'row')} of \`${item.table}\` deleted, keeping each parent's first row`,
      );
      affected.add(item.table);
    }
    pending = [];
    for (const item of queue) {
      const clears = nullable.has(`${item.table}.${item.foreignKey.column}`);
      if (!clears && wrappers.has(item.table)) {
        const doomed = danglingCondition(dialect, item.table, item.foreignKey, item.targetCreated);
        lines.push(...(await sweepWrapperRows(db, dialect, sweepable, item.table, doomed)));
      }
      const purge = clears
        ? clearSQL(dialect, item.table, item.foreignKey, item.targetCreated)
        : deleteSQL(dialect, item.table, item.foreignKey, item.targetCreated);
      const { changes } = await db.run(purge);
      if (changes === 0) continue;
      lines.push(purgedLine(item.table, item.foreignKey, changes, clears));
      if (!clears) affected.add(item.table);
    }
    queue = [];
    for (const probe of universe) {
      if (!affected.has(probe.foreignKey.targetTable)) continue;
      const count = await countDangling(db, dialect, probe.table, probe.foreignKey);
      if (count > 0) queue.push({ ...probe, count, targetCreated: false });
    }
  }
  return lines;
}

/**
 * The live owned tables the block sweep may touch: everything this sync keeps.
 * A table being dropped dies whole - its rows are already accounted as a loss, never swept twice.
 * A wrapper reshaped into something else keeps its table but leaves the wrapper universe.
 */
function sweepUniverse(
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
  desired: readonly TableSchema[],
): SweepTable[] {
  const dropping = new Set(
    diffs.flatMap((diff) => (diff.kind === 'drop' ? [diff.table.name] : [])),
  );
  const desiredByName = keyBy(desired, (table) => table.name);
  return live
    .filter((table) => !dropping.has(table.name))
    .map((table) => {
      const retired =
        table.derived?.kind === 'blocksWrapper' &&
        desiredByName[table.name]?.derived?.kind !== 'blocksWrapper';
      return retired
        ? { name: table.name, block: table.block }
        : { name: table.name, derived: table.derived, block: table.block };
    });
}

/**
 * The live wrappers leaving the schema this sync: dropped, or no longer a wrapper as desired.
 * Their rows all die, so every block instance only they referenced sweeps before the structure goes.
 */
function retiredWrappers(live: readonly TableSchema[], desired: readonly TableSchema[]): string[] {
  const desiredByName = keyBy(desired, (table) => table.name);
  return live
    .filter((table) => table.derived?.kind === 'blocksWrapper')
    .filter((table) => table.columns.some((column) => column.name === '_blockType'))
    .filter((table) => desiredByName[table.name]?.derived?.kind !== 'blocksWrapper')
    .map((table) => table.name);
}

/**
 * Whether a table belongs to a block: the per-type table itself, or one derived beneath it.
 */
function blockOwned(table: TableSchema): boolean {
  return !isUndefined(table.block) || !isUndefined(table.derived?.block);
}

/**
 * Collects the `table.column` keys safe to clear: nullable live and nullable (or absent) desired.
 * A table without a diff keeps its live shape, so live alone decides there.
 */
function nullableColumns(diffs: readonly TableDiff[], live: readonly TableSchema[]): Set<string> {
  const desired = new Map(
    diffs.flatMap((diff) =>
      diff.kind === 'alter' ? [[diff.desired.name, diff.desired] as const] : [],
    ),
  );
  const safe = new Set<string>();
  for (const table of live) {
    const desiredColumns = desired.get(table.name)?.columns;
    for (const column of table.columns) {
      if (column.notNull) continue;
      const target = desiredColumns?.find((candidate) => candidate.name === column.name);
      if (!isUndefined(target) && target.notNull) continue;
      safe.add(`${table.name}.${column.name}`);
    }
  }
  return safe;
}

/**
 * Collects every foreign key that could newly dangle when a purge deletes its target's rows.
 * Surviving live foreign keys count, and added ones whose column already exists live.
 * A foreign key to a table created this sync is exempt: its initial purge removes every value.
 */
function probeUniverse(
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
): { table: string; foreignKey: ForeignKeySchema }[] {
  const creating = new Set(
    diffs.flatMap((diff) => (diff.kind === 'create' ? [diff.table.name] : [])),
  );
  const dropping = new Set(
    diffs.flatMap((diff) => (diff.kind === 'drop' ? [diff.table.name] : [])),
  );
  const alters = new Map(
    diffs.flatMap((diff) => (diff.kind === 'alter' ? [[diff.desired.name, diff] as const] : [])),
  );
  const universe: { table: string; foreignKey: ForeignKeySchema }[] = [];
  for (const table of live) {
    if (dropping.has(table.name)) continue;
    const alter = alters.get(table.name);
    for (const foreignKey of table.foreignKeys) {
      const dropped =
        alter?.dropForeignKeys.some((item) => item.column === foreignKey.column) ?? false;
      if (!dropped) universe.push({ table: table.name, foreignKey });
    }
    for (const foreignKey of alter?.addForeignKeys ?? []) {
      if (creating.has(foreignKey.targetTable)) continue;
      if (!table.columns.some((column) => column.name === foreignKey.column)) continue;
      universe.push({ table: table.name, foreignKey });
    }
  }
  return universe;
}

/**
 * Assembles the sectioned refusal body: destructions first, unforceable blockers after, then the fix.
 * Block-owned findings have no migration to write, so the migration hint appears only for the rest.
 */
function refusalBody(migratable: string[], blockGrade: string[], blockers: string[]): string[] {
  const body: string[] = [];
  const destructive = [...migratable, ...blockGrade];
  if (destructive.length > 0) {
    body.push('Applying the desired schema would destroy:', '', ...destructive);
  }
  if (blockers.length > 0) {
    if (body.length > 0) body.push('');
    body.push('These cannot apply even under force:', '', ...blockers);
  }
  body.push('');
  if (blockers.length > 0) {
    body.push(
      'Fix the data behind these rows first, or rewrite it with a move migration; `force` cannot resolve them.',
    );
    return body;
  }
  if (migratable.length > 0) {
    body.push('Cover these with a discard or move migration.');
    body.push(
      'Or set `FORCE_SYNC` or `database.sync.force` to authorize this destruction for one boot.',
    );
    return body;
  }
  body.push(
    'Set `FORCE_SYNC` or `database.sync.force` to authorize this destruction for one boot.',
  );
  return body;
}

/**
 * Detects a many -> one cardinality collapse on one alter, returning the unique that pins it.
 * The signature: the desired shape uniques exactly `_parentUUID` while `_parentPosition` drops.
 * Only the desired builder emits these internal columns, so the signature is unambiguous.
 */
function detectCollapse(alter: TableAlter): IndexSchema | undefined {
  if (!alter.dropColumns.some((column) => column.name === '_parentPosition')) return undefined;
  return alter.addUniques.find(
    (unique) => unique.columns.length === 1 && unique.columns[0] === '_parentUUID',
  );
}

/**
 * One report line for rows dangling from a foreign key.
 */
function danglingLine(table: string, foreignKey: ForeignKeySchema, count: number): string {
  return `- \`${count}\` ${pluralize(count, 'row')} of \`${table}\` ${count === 1 ? 'dangles' : 'dangle'} from \`${table}.${foreignKey.column}\` to missing \`${foreignKey.targetTable}\` rows`;
}

/**
 * One report line for parents whose many rows collapse onto one.
 */
function collapseLine(table: string, groups: number): string {
  return `- \`${groups}\` ${pluralize(groups, 'parent')} of \`${table}\` ${groups === 1 ? 'holds' : 'hold'} multiple rows; only each parent's first row survives`;
}

/**
 * One report line for wrapper rows holding a block type outside the desired allow set.
 */
function disallowedLine(table: string, type: string, count: number): string {
  return `- \`${count}\` ${pluralize(count, 'row')} of \`${table}\` ${count === 1 ? 'holds' : 'hold'} block \`${type}\`, no longer allowed there`;
}

/**
 * Counts a table's rows.
 */
async function countRows(db: Transaction, dialect: Dialect, table: string): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(table)}`,
  );
  return row?.count ?? 0;
}

/**
 * Counts a table's rows matching `condition`.
 */
async function countWhere(
  db: Transaction,
  dialect: Dialect,
  table: string,
  condition: string,
): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(table)} WHERE ${condition}`,
  );
  return row?.count ?? 0;
}

/**
 * Counts value groups that would collide under a unique.
 * NULLs never collide in a unique, so rows holding one are excluded before grouping.
 */
async function countDuplicateGroups(
  db: Transaction,
  dialect: Dialect,
  table: string,
  columns: readonly string[],
): Promise<number> {
  const list = columns.map((column) => dialect.quote(column)).join(', ');
  const notNull = columns.map((column) => `${dialect.quote(column)} IS NOT NULL`).join(' AND ');
  const row = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS ${dialect.quote('count')} FROM (` +
      `SELECT 1 FROM ${dialect.quote(table)} WHERE ${notNull} ` +
      `GROUP BY ${list} HAVING COUNT(*) > 1) AS ${dialect.quote('duplicates')}`,
  );
  return row?.count ?? 0;
}

/**
 * Counts rows whose foreign-key value points at no target row.
 * The outer table is aliased so a self-referencing foreign key compares two distinct rows.
 */
async function countDangling(
  db: Transaction,
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(table)} AS ${dialect.quote('_row')} ` +
      `WHERE ${dialect.quote('_row')}.${dialect.quote(foreignKey.column)} IS NOT NULL AND NOT EXISTS (` +
      `SELECT 1 FROM ${dialect.quote(foreignKey.targetTable)} AS ${dialect.quote('_target')} ` +
      `WHERE ${dialect.quote('_target')}.${dialect.quote(foreignKey.targetColumn)} = ` +
      `${dialect.quote('_row')}.${dialect.quote(foreignKey.column)})`,
  );
  return row?.count ?? 0;
}

/**
 * Builds the `DELETE` keeping each parent's first row: lowest `_parentPosition`, `UUID` breaking ties.
 * Set-based on purpose: the table's indexes are already down, so a correlated scan would go quadratic.
 */
function collapseSQL(dialect: Dialect, table: string): string {
  const parent = dialect.quote('_parentUUID');
  const position = dialect.quote('_parentPosition');
  const uuid = dialect.quote('UUID');
  const from = `FROM ${dialect.quote(table)}`;
  return (
    `DELETE ${from} WHERE ${uuid} NOT IN (` +
    `SELECT MIN(${uuid}) ${from} ` +
    `WHERE (${parent}, ${position}) IN (` +
    `SELECT ${parent}, MIN(${position}) ${from} GROUP BY ${parent}) ` +
    `GROUP BY ${parent})`
  );
}
