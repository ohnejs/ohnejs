import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { ProcessedScope } from '../pipeline/run-record.ts';

import { chunk, groupBy, isNullish, isString, isUndefined, uuidv7 } from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';

/**
 * One ordering constraint: `writer`'s new unique value is what `holder`'s kept row currently stores.
 * The writer must run after the holder moves off the value, or the unique index fires mid-write.
 */
interface Edge {
  holder: number;
  writer: number;
  sub: FieldQueryMeta;
}

/**
 * Orders one composite field's item writes so a unique value never lands before its holder frees it.
 *
 * Kept items may swap and shift unique subfield values; the final state is what the precheck proved free.
 * Each row still rewrites in its own statement, so order decides whether the index fires mid-write.
 * With no unique subfield or no kept item the input order returns untouched, costing nothing.
 * Otherwise the kept rows' current unique values read once.
 * A write landing on a still-stored value orders after the write that moves it off; elimination resolves.
 * A true swap cycles; the lowest-index holder breaks it with a sentinel write on the held columns.
 * The sentinel is `NULL` on a nullable column, a fresh `uuidv7` on text, a probed free integer else.
 * A non-nullable boolean has no third value, so its cycle stays and the constraint decides.
 * Returns the item indexes in write order; positions bind by index, so reordering changes no state.
 */
export async function orderItemWrites(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  items: readonly ProcessedScope[],
): Promise<number[]> {
  return orderIndexes(
    tx,
    dialect,
    table,
    subfields,
    items,
    items.map((_item, index) => index),
  );
}

/**
 * Orders a blocks field's item writes per block type, since each type rewrites its own table.
 * Items of one type order among themselves exactly as repeater items do; types stay independent.
 */
export async function orderBlockItemWrites(
  tx: Transaction,
  dialect: Dialect,
  items: readonly ProcessedScope[],
): Promise<number[]> {
  const groups = groupBy(
    items.map((_item, index) => index),
    (index) => items[index].blockType as string,
  );
  const sequence: number[] = [];
  for (const [type, indexes] of Object.entries(groups)) {
    if (isUndefined(indexes)) continue;
    const meta = blockQueryMetadata(type);
    sequence.push(...(await orderIndexes(tx, dialect, meta.table, meta.fields, items, indexes)));
  }
  return sequence;
}

/**
 * The core ordering over one table's subset of item indexes, shared by both entry points.
 */
async function orderIndexes(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  items: readonly ProcessedScope[],
  indexes: readonly number[],
): Promise<number[]> {
  const uniques = Object.entries(subfields).filter(
    ([, sub]) => (sub.kind === 'column' || sub.kind === 'record') && sub.options?.unique === true,
  );
  const kept = indexes.filter((index) => isString(items[index].itemUUID));
  if (uniques.length === 0 || kept.length === 0) return [...indexes];

  const stored = await storedRows(
    tx,
    dialect,
    table,
    uniques.map(([, sub]) => sub.column as string),
    kept.map((index) => items[index].itemUUID as string),
  );

  let edges: Edge[] = [];
  for (const [, sub] of uniques) {
    const column = sub.column as string;
    const type = sub.logicalType as LogicalType;
    const holders = new Map<SQLValue, number>();
    for (const index of kept) {
      const value = stored.get(items[index].itemUUID as string)?.[column];
      if (!isNullish(value)) holders.set(value, index);
    }
    for (const index of indexes) {
      const next = items[index].columns[column];
      if (isNullish(next)) continue;
      const holder = holders.get(dialect.serialize(type, next));
      if (isUndefined(holder) || holder === index) continue;
      edges.push({ holder, writer: index, sub });
    }
  }
  if (edges.length === 0) return [...indexes];

  const pending = new Set(indexes);
  const sequence: number[] = [];
  while (pending.size > 0) {
    const free = [...pending].filter(
      (index) => !edges.some((edge) => edge.writer === index && pending.has(edge.holder)),
    );
    if (free.length > 0) {
      for (const index of free) {
        pending.delete(index);
        sequence.push(index);
      }
      continue;
    }
    // Every pending write waits on another's stored value: a swap cycle. Break the lowest holder.
    const holder = Math.min(
      ...[...pending].filter((index) => edges.some((edge) => edge.holder === index)),
    );
    const held = new Set(edges.filter((edge) => edge.holder === holder).map((edge) => edge.sub));
    for (const sub of held) {
      await writeSentinel(tx, dialect, table, sub, items[holder].itemUUID as string);
    }
    edges = edges.filter((edge) => edge.holder !== holder);
  }
  return sequence;
}

/**
 * The kept rows' current unique-column values, keyed by row `UUID`.
 */
async function storedRows(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  columns: readonly string[],
  uuids: readonly string[],
): Promise<Map<string, Record<string, SQLValue>>> {
  const stored = new Map<string, Record<string, SQLValue>>();
  const select = ['UUID', ...columns].map((column) => dialect.quote(column)).join(', ');
  for (const batch of chunk(uuids, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<Record<string, SQLValue>>(
      `SELECT ${select} FROM ${dialect.quote(table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...batch],
    );
    for (const row of rows) stored.set(row.UUID as string, row);
  }
  return stored;
}

/**
 * Moves one kept row off its held unique value, so the writes waiting on it can land.
 * A non-nullable boolean writes nothing: no third value exists, and the constraint decides.
 */
async function writeSentinel(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  sub: FieldQueryMeta,
  uuid: string,
): Promise<void> {
  const column = sub.column as string;
  const type = sub.logicalType as LogicalType;
  if (!sub.nullable && type === 'boolean') return;
  const value = sub.nullable ? null : await freeValue(tx, dialect, table, column, type);
  await tx.run(
    `UPDATE ${dialect.quote(table)} SET ${dialect.quote(column)} = ? WHERE ${dialect.quote('UUID')} = ?`,
    [value, uuid],
  );
}

/**
 * A value no row of the table holds: a fresh `uuidv7` for text shapes, one past the maximum else.
 */
async function freeValue(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  column: string,
  type: LogicalType,
): Promise<SQLValue> {
  if (type === 'text' || type === 'json') return dialect.serialize(type, uuidv7());
  const row = await tx.queryOne<{ max: number | null }>(
    `SELECT MAX(${dialect.quote(column)}) AS ${dialect.quote('max')} FROM ${dialect.quote(table)}`,
  );
  return (row?.max ?? 0) + 1;
}
