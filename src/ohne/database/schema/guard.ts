import type { Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type {
  ForeignKeySchema,
  IndexSchema,
  TableAlter,
  TableDiff,
  TableSchema,
} from './table-schema.ts';

import { isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';

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
 * What the guard let through.
 */
export interface GuardReport {
  /**
   * One line per destroyed or purged item, ready for a single warn block.
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

interface Findings {
  losses: string[];
  purgeable: DanglingFinding[];
  collapses: CollapseFinding[];
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
 * Every finding lands in one error block; probes run before any mutation, so a re-add cannot explode.
 */
export async function guardDiffs(
  db: Transaction,
  dialect: Dialect,
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
  options: GuardOptions,
): Promise<GuardReport> {
  const findings: Findings = {
    losses: [],
    purgeable: [],
    collapses: [],
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
      if (rows > 0) findings.losses.push(`- table \`${diff.table.name}\` (\`${rows}\` rows)`);
      continue;
    }
    await guardAlter(db, dialect, diff, creating, findings);
  }
  const destructive = [
    ...findings.losses,
    ...findings.purgeable.map((item) => danglingLine(item.table, item.foreignKey, item.count)),
    ...findings.collapses.map((item) => collapseLine(item.table, item.groups)),
  ];
  if (findings.blockers.length > 0 || (destructive.length > 0 && !options.force)) {
    throw ohneError({
      title: 'Destructive sync refused',
      body: refusalBody(destructive, findings.blockers),
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
  const purged = await purgeDangling(
    db,
    dialect,
    [...findings.purgeable, ...findings.orphans],
    findings.collapses,
    diffs,
    live,
  );
  return { deletions: [...findings.losses, ...purged], warnings: [] };
}

/**
 * Probes one alter's columns, uniques, primary key, and foreign keys, pushing findings by grade.
 * Structure arriving in this sync is never probed against the live table.
 * A just-added column holds no values, so nothing over it can collide or dangle.
 * A foreign key to a table created this sync makes every non-NULL value dangle by definition.
 * A detected cardinality collapse absorbs its `_parentPosition` drop: ordering is structure, not data.
 */
async function guardAlter(
  db: Transaction,
  dialect: Dialect,
  alter: TableAlter,
  creating: ReadonlySet<string>,
  findings: Findings,
): Promise<void> {
  const table = alter.desired.name;
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
    if (values > 0)
      findings.losses.push(`- column \`${table}.${column.name}\` (\`${values}\` values)`);
  }
  for (const change of alter.changeColumns) {
    const name = change.desired.name;
    const retyped =
      dialect.columnType(change.live.type) !== dialect.columnType(change.desired.type);
    if (retyped && change.desired.notNull && rows > 0) {
      findings.blockers.push(
        `- column \`${table}.${name}\` retypes under NOT NULL, leaving \`${rows}\` rows without a value`,
      );
      continue;
    }
    if (retyped) {
      const values = await countWhere(db, dialect, table, `${dialect.quote(name)} IS NOT NULL`);
      if (values > 0) {
        findings.losses.push(
          `- column \`${table}.${name}\` (\`${values}\` values, \`${change.live.type}\` -> \`${change.desired.type}\`)`,
        );
      }
    }
    if (!change.live.notNull && change.desired.notNull) {
      const nulls = await countWhere(db, dialect, table, `${dialect.quote(name)} IS NULL`);
      if (nulls > 0) {
        findings.blockers.push(
          `- column \`${table}.${name}\` becomes NOT NULL over \`${nulls}\` NULL rows`,
        );
      }
    }
  }
  if (rows > 0) {
    for (const column of alter.addColumns) {
      if (!column.notNull) continue;
      findings.blockers.push(
        `- new column \`${table}.${column.name}\` is NOT NULL but \`${table}\` holds \`${rows}\` rows`,
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
    findings.blockers.push(`- unique \`${unique.name}\` covers \`${groups}\` duplicate groups`);
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
      findings.blockers.push(`- primary key over ${key} covers \`${groups}\` duplicate groups`);
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
 * Executes the collapse and dangling purges to a fixed point, following foreign keys onto orphans.
 * A collapse deletes every row after each parent's first, before the dangling purges run.
 * A dangling value is cleared to `NULL` where the column permits it both live and desired.
 * Live governs because purges run before any structural apply; desired governs the end state.
 * Everywhere else the rows are deleted.
 * A deleted row can strand rows referencing it, on tables this sync never touched.
 * Every foreign key aiming at a purged table is therefore re-probed until a pass deletes nothing.
 * Clearing values orphans nothing, so only deletions feed the re-probe.
 * Returns one report line per executed purge, counting what it actually cleared or deleted.
 */
async function purgeDangling(
  db: Transaction,
  dialect: Dialect,
  initial: readonly DanglingFinding[],
  collapses: readonly CollapseFinding[],
  diffs: readonly TableDiff[],
  live: readonly TableSchema[],
): Promise<string[]> {
  const lines: string[] = [];
  const universe = probeUniverse(diffs, live);
  const nullable = nullableColumns(diffs, live);
  let queue = [...initial];
  let pending = [...collapses];
  while (queue.length > 0 || pending.length > 0) {
    const affected = new Set<string>();
    for (const item of pending) {
      const { changes } = await db.run(collapseSQL(dialect, item.table));
      if (changes === 0) continue;
      lines.push(
        `- \`${changes}\` rows of \`${item.table}\` deleted, keeping each parent's first row`,
      );
      affected.add(item.table);
    }
    pending = [];
    for (const item of queue) {
      const clears = nullable.has(`${item.table}.${item.foreignKey.column}`);
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
 */
function refusalBody(destructive: string[], blockers: string[]): string[] {
  const body: string[] = [];
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
  } else {
    body.push('Cover these with a discard or move migration.');
    body.push(
      'Or set `FORCE_SYNC` or `database.sync.force` to authorize this destruction for one boot.',
    );
  }
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
  return `- \`${count}\` rows of \`${table}\` dangle from \`${table}.${foreignKey.column}\` to missing \`${foreignKey.targetTable}\` rows`;
}

/**
 * One report line for parents whose many rows collapse onto one.
 */
function collapseLine(table: string, groups: number): string {
  return `- \`${groups}\` parents of \`${table}\` hold multiple rows; only each parent's first row survives`;
}

/**
 * One report line for an executed purge: values cleared to `NULL`, or rows deleted.
 */
function purgedLine(
  table: string,
  foreignKey: ForeignKeySchema,
  count: number,
  cleared: boolean,
): string {
  return cleared
    ? `- \`${count}\` values of \`${table}.${foreignKey.column}\` cleared, dangling to missing \`${foreignKey.targetTable}\` rows`
    : `- \`${count}\` rows of \`${table}\` deleted, dangling from \`${table}.${foreignKey.column}\` to missing \`${foreignKey.targetTable}\` rows`;
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
 * Builds the condition matching rows whose foreign-key value dangles.
 * When the target table arrives this sync it is empty, so every non-NULL value dangles by definition.
 *
 * The purge target cannot wear an alias inside `UPDATE`/`DELETE`, so the outer column is table-qualified.
 * The subquery alias is therefore `_`-prefixed: user identifiers never start with `_`.
 * No table name can capture the outer qualifier the way a table named `Target` would capture `target`.
 */
function danglingCondition(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  const column = `${dialect.quote(table)}.${dialect.quote(foreignKey.column)}`;
  if (targetCreated) return `${column} IS NOT NULL`;
  return (
    `${column} IS NOT NULL AND NOT EXISTS (` +
    `SELECT 1 FROM ${dialect.quote(foreignKey.targetTable)} AS ${dialect.quote('_target')} ` +
    `WHERE ${dialect.quote('_target')}.${dialect.quote(foreignKey.targetColumn)} = ${column})`
  );
}

/**
 * Builds the `UPDATE` that clears dangling foreign-key values to `NULL`.
 */
function clearSQL(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  return (
    `UPDATE ${dialect.quote(table)} SET ${dialect.quote(foreignKey.column)} = NULL ` +
    `WHERE ${danglingCondition(dialect, table, foreignKey, targetCreated)}`
  );
}

/**
 * Builds the `DELETE` that removes rows dangling from `foreignKey`.
 */
function deleteSQL(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  return (
    `DELETE FROM ${dialect.quote(table)} ` +
    `WHERE ${danglingCondition(dialect, table, foreignKey, targetCreated)}`
  );
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
