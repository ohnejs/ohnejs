import type { Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type { ForeignKeySchema, TableAlter, TableDiff } from './table-schema.ts';

import { ohneError } from '../../error/ohne-error.ts';

/**
 * Guard behavior switches.
 */
export interface GuardOptions {
  /**
   * Authorizes destructive findings for this run and performs the purges they report.
   * Duplicate-unique and NULL-over-NOT-NULL findings stay refusals - force cannot resolve them.
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

interface Findings {
  losses: string[];
  purgeable: { line: string; purge: string }[];
  blockers: string[];
  orphans: { line: string; purge: string }[];
}

/**
 * The destructive guard: probes every diff and refuses what would silently lose data.
 * A populated table or column drop and a populated retype refuse unless `force` authorizes them.
 * A new unique over duplicates or `NOT NULL` over NULLs refuses regardless - force cannot pick winners.
 * Rows dangling under a foreign key being added refuse too; under force they are deleted here.
 * Pre-existing orphans under a surviving foreign key only warn; under force they are purged as well.
 * Every finding lands in one error block; probes run before any mutation, so a re-add cannot explode.
 */
export async function guardDiffs(
  db: Transaction,
  dialect: Dialect,
  diffs: readonly TableDiff[],
  options: GuardOptions,
): Promise<GuardReport> {
  const findings: Findings = { losses: [], purgeable: [], blockers: [], orphans: [] };
  for (const diff of diffs) {
    if (diff.kind === 'create') continue;
    if (diff.kind === 'drop') {
      const rows = await countRows(db, dialect, diff.table.name);
      if (rows > 0) findings.losses.push(`- table \`${diff.table.name}\` (\`${rows}\` rows)`);
      continue;
    }
    await guardAlter(db, dialect, diff, findings);
  }
  const destructive = [...findings.losses, ...findings.purgeable.map((item) => item.line)];
  if (findings.blockers.length > 0 || (destructive.length > 0 && !options.force)) {
    throw ohneError({
      title: 'Destructive sync refused',
      body: refusalBody(destructive, findings.blockers),
    });
  }
  if (!options.force) {
    return { deletions: [], warnings: findings.orphans.map((orphan) => orphan.line) };
  }
  for (const item of [...findings.purgeable, ...findings.orphans]) {
    await db.run(item.purge);
  }
  return {
    deletions: [...destructive, ...findings.orphans.map((orphan) => orphan.line)],
    warnings: [],
  };
}

/**
 * Probes one alter's columns, uniques, primary key, and foreign keys, pushing findings by grade.
 */
async function guardAlter(
  db: Transaction,
  dialect: Dialect,
  alter: TableAlter,
  findings: Findings,
): Promise<void> {
  const table = alter.desired.name;
  const rows = await countRows(db, dialect, table);
  for (const column of alter.dropColumns) {
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
    if (dialect.columnType(change.live.type) !== dialect.columnType(change.desired.type)) {
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
    const groups = await countDuplicateGroups(db, dialect, table, unique.columns);
    if (groups > 0) {
      findings.blockers.push(`- unique \`${unique.name}\` covers \`${groups}\` duplicate groups`);
    }
  }
  if (alter.changePrimaryKey && alter.desired.primaryKey.length > 0 && rows > 0) {
    const groups = await countDuplicateGroups(db, dialect, table, alter.desired.primaryKey);
    if (groups > 0) {
      const key = alter.desired.primaryKey.map((column) => `\`${column}\``).join(', ');
      findings.blockers.push(`- primary key over ${key} covers \`${groups}\` duplicate groups`);
    }
  }
  for (const foreignKey of alter.addForeignKeys) {
    const dangling = await countDangling(db, dialect, table, foreignKey);
    if (dangling === 0) continue;
    findings.purgeable.push({
      line: danglingLine(table, foreignKey, dangling),
      purge: purgeSQL(dialect, table, foreignKey),
    });
  }
  const surviving = alter.live.foreignKeys.filter(
    (foreignKey) => !alter.dropForeignKeys.some((dropped) => dropped.column === foreignKey.column),
  );
  for (const foreignKey of surviving) {
    const dangling = await countDangling(db, dialect, table, foreignKey);
    if (dangling === 0) continue;
    findings.orphans.push({
      line: danglingLine(table, foreignKey, dangling),
      purge: purgeSQL(dialect, table, foreignKey),
    });
  }
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
  body.push(
    blockers.length > 0
      ? 'Fix the data behind these rows first; `force` cannot resolve them.'
      : 'Set `FORCE_SYNC` or `database.sync.force` to authorize this destruction for one boot.',
  );
  return body;
}

/**
 * One report line for rows dangling from a foreign key.
 */
function danglingLine(table: string, foreignKey: ForeignKeySchema, count: number): string {
  return `- \`${count}\` rows of \`${table}\` dangle from \`${table}.${foreignKey.column}\` to missing \`${foreignKey.targetTable}\` rows`;
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
    `SELECT COUNT(*) AS ${dialect.quote('count')} FROM ${dialect.quote(table)} AS ${dialect.quote('row')} ` +
      `WHERE ${dialect.quote('row')}.${dialect.quote(foreignKey.column)} IS NOT NULL AND NOT EXISTS (` +
      `SELECT 1 FROM ${dialect.quote(foreignKey.targetTable)} AS ${dialect.quote('target')} ` +
      `WHERE ${dialect.quote('target')}.${dialect.quote(foreignKey.targetColumn)} = ` +
      `${dialect.quote('row')}.${dialect.quote(foreignKey.column)})`,
  );
  return row?.count ?? 0;
}

/**
 * Builds the `DELETE` that removes rows dangling from `foreignKey`.
 */
function purgeSQL(dialect: Dialect, table: string, foreignKey: ForeignKeySchema): string {
  return (
    `DELETE FROM ${dialect.quote(table)} ` +
    `WHERE ${dialect.quote(foreignKey.column)} IS NOT NULL AND NOT EXISTS (` +
    `SELECT 1 FROM ${dialect.quote(foreignKey.targetTable)} AS ${dialect.quote('target')} ` +
    `WHERE ${dialect.quote('target')}.${dialect.quote(foreignKey.targetColumn)} = ` +
    `${dialect.quote(table)}.${dialect.quote(foreignKey.column)})`
  );
}
