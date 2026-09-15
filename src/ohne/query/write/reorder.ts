import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { ProcessedScope } from '../pipeline/run-record.ts';

import { isNullish, isUndefined } from '../../../utils/index.ts';

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
 * One step of a kept-row write order: a row's rewrite by index, or a sentinel freeing a held value.
 */
export type OrderStep =
  | { kind: 'item'; index: number }
  | { kind: 'sentinel'; sub: FieldQueryMeta; uuid: string };

/**
 * One kept row's pending rewrite: its new values beside the stored ones the reconcile plan read.
 */
export interface KeptWrite {
  /**
   * The kept row's `UUID`.
   */
  uuid: string;

  /**
   * The parent the row hangs off, scoping a `uniquePerParent` constraint to its own list.
   */
  parent: string;

  /**
   * The row's effective item scope; `columns` holds the values the rewrite lands.
   */
  scope: ProcessedScope;

  /**
   * The row's currently stored unique-column values.
   */
  stored: Record<string, SQLValue>;
}

/**
 * The unique column subfields of one table, the ones whose kept values can constrain write order.
 */
export function uniqueSubfields(subfields: Record<string, FieldQueryMeta>): FieldQueryMeta[] {
  return Object.values(subfields).filter(
    (sub) => (sub.kind === 'column' || sub.kind === 'record') && sub.options?.unique === true,
  );
}

/**
 * Orders one table's kept rewrites so a unique value never lands before its holder frees it.
 *
 * The rows span every parent and depth the plan rewrites in the table.
 * A table-wide `unique` column therefore constrains across rows wherever they sit in the tree.
 * A `uniquePerParent` column constrains only rows under one parent, matching its index scope.
 * Each row still rewrites in its own statement, so order decides whether the index fires mid-write.
 * Returns `null` when nothing constrains the order, so unconstrained rewrites stay batchable.
 * A write landing on a still-stored value orders after the write that moves it off; elimination resolves.
 * A true swap cycles; the lowest-index holder breaks it with a sentinel step on the held columns.
 * Only kept rows order here, since fresh items always insert after every kept rewrite.
 * A fresh value waiting on a kept row's old value is therefore satisfied by construction.
 */
export function orderKeptWrites(
  dialect: Dialect,
  rows: readonly KeptWrite[],
  subfields: Record<string, FieldQueryMeta>,
): OrderStep[] | null {
  const uniques = uniqueSubfields(subfields);
  if (uniques.length === 0 || rows.length === 0) return null;

  let edges: Edge[] = [];
  for (const sub of uniques) {
    const column = sub.column as string;
    const type = sub.logicalType as LogicalType;
    const perParent = sub.options?.uniquePerParent === true;
    const scopeOf = (index: number): string => (perParent ? rows[index].parent : '');
    const holders = new Map<string, Map<SQLValue, number>>();
    for (let index = 0; index < rows.length; index++) {
      const value = rows[index].stored[column];
      if (isNullish(value)) continue;
      let bucket = holders.get(scopeOf(index));
      if (isUndefined(bucket)) {
        bucket = new Map();
        holders.set(scopeOf(index), bucket);
      }
      bucket.set(value, index);
    }
    for (let index = 0; index < rows.length; index++) {
      const next = rows[index].scope.columns[column];
      if (isNullish(next)) continue;
      const holder = holders.get(scopeOf(index))?.get(dialect.serialize(type, next));
      if (isUndefined(holder) || holder === index) continue;
      edges.push({ holder, writer: index, sub });
    }
  }
  if (edges.length === 0) return null;

  const pending = new Set(rows.map((_row, index) => index));
  const sequence: OrderStep[] = [];
  while (pending.size > 0) {
    const free = [...pending].filter(
      (index) => !edges.some((edge) => edge.writer === index && pending.has(edge.holder)),
    );
    if (free.length > 0) {
      for (const index of free) {
        pending.delete(index);
        sequence.push({ kind: 'item', index });
      }
      continue;
    }
    const holder = Math.min(
      ...[...pending].filter((index) => edges.some((edge) => edge.holder === index)),
    );
    const held = new Set(edges.filter((edge) => edge.holder === holder).map((edge) => edge.sub));
    for (const sub of held) {
      sequence.push({ kind: 'sentinel', sub, uuid: rows[holder].uuid });
    }
    edges = edges.filter((edge) => edge.holder !== holder);
  }
  return sequence;
}
