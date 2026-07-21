import type { CollectionName } from '../../collections/known-collections.ts';
import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { SQLFragment } from '../sql/fragment.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { assertBoundParams } from '../sql/fragment.ts';
import { compileLimit, compileOrder } from '../sql/order.ts';
import { compileSelect } from '../sql/select.ts';
import { compileWhere } from '../sql/where.ts';
import { hydrateScope } from './hydrate.ts';
import { applyPopulate } from './loaders/populate.ts';
import { resolveIR } from './resolve-ir.ts';

/**
 * One assembled record: field names mapped to their deserialized values.
 */
export type QueryRecord = Record<string, unknown>;

declare module 'ohne' {
  interface Hooks {
    /**
     * Filters the whole assembled rowset once, after hydrate and populate, just before a row read returns.
     * Fires for `findMany`, `findFirst`, and `pluck`'s fallback, the reads that return records.
     * `count`, `exists`, and `pluck`'s column path return a scalar or a column list, so they do not fire.
     * Runs once over the array, never per row: add computed fields, redact output, or decrypt at rest.
     * The `context` carries the read's `collection` and its resolved `ir`, the snapshot after `query:filter`.
     * Return a replacement `QueryRecord[]`, or mutate the array in place and return nothing to keep it.
     */
    'query:records': (
      records: QueryRecord[],
      context: { collection: CollectionName; ir: QueryIR },
    ) => void | QueryRecord[] | Promise<void | QueryRecord[]>;

    /**
     * Runs once when a row read finishes, carrying its timing and shape, an action for logging or metrics.
     * Fires only for the record reads (`findMany`, `findFirst`, `pluck`'s fallback), where `rowCount` is honest.
     * `count` and `exists` return a scalar and do not fire; time those at the database adapter.
     * `durationMs` spans compile, query, hydrate, populate, and `query:records`, on the monotonic clock.
     * `rowCount` is the returned record count, after `query:filter` scoping and any `query:records` transform.
     * The `ir` is the resolved snapshot the read executed, the state after `query:filter`.
     */
    'query:complete': (info: {
      collection: CollectionName;
      ir: QueryIR;
      rowCount: number;
      durationMs: number;
    }) => void | Promise<void>;
  }
}

/**
 * Compiles the tail every read shares: the optional `WHERE`, the total `ORDER BY`, and the row window.
 *
 * The condition, order keys, and limit/offset compile against the collection's metadata and dialect.
 * The `UUID` tiebreaker keeps the order total, so repeated reads and pagination stay stable.
 * The head - the projection - varies per read, so the caller prepends it to this fragment.
 */
export function compileReadTail(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  const parts: string[] = [];
  const params: SQLValue[] = [];
  if (!isNull(ir.condition)) {
    const where = compileWhere(ir.condition, meta, dialect, locale);
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  parts.push(`ORDER BY ${compileOrder(ir, meta, dialect)}`);
  const limit = compileLimit(ir);
  if (limit.sql !== '') {
    parts.push(limit.sql);
    params.push(...limit.params);
  }
  return { sql: parts.join(' '), params };
}

/**
 * Reads and assembles every row a snapshot selects, hydrating and populating its column-less fields.
 *
 * The projection, condition, order, and window compile against the ambient connection and dialect.
 * Column values cross back through `dialect.deserialize`.
 * `records` relations and composites hydrate over the rowset in batched loader reads.
 * Populated relations then swap their `UUID`s for full records.
 */
export async function readRows(ir: QueryIR): Promise<QueryRecord[]> {
  ir = await resolveIR(ir);
  const completing = useHooks().get('query:complete');
  const start = isUndefined(completing) || completing.length === 0 ? null : performance.now();
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const locale = effectiveLocale(ir.locale);
  const head = compileSelect(ir, meta, dialect, locale);
  const tail = compileReadTail(ir, meta, dialect, locale);
  assertBoundParams(head.params.length + tail.params.length, dialect.maxParameters);
  const rows = await useDatabase().query<Record<string, SQLValue>>(`${head.sql} ${tail.sql}`, [
    ...head.params,
    ...tail.params,
  ]);
  const hydrated = await hydrateScope(meta.fields, rows, ir.select, dialect, locale);
  await applyPopulate(ir, meta, hydrated, dialect);
  const records = await resolveRecords(hydrated, ir);
  if (!isNull(start)) {
    await applyHook('query:complete', {
      collection: ir.collection as CollectionName,
      ir,
      rowCount: records.length,
      durationMs: performance.now() - start,
    });
  }
  return records;
}

async function resolveRecords(records: QueryRecord[], ir: QueryIR): Promise<QueryRecord[]> {
  const callbacks = useHooks().get('query:records');
  if (isUndefined(callbacks) || callbacks.length === 0) return records;
  return applyHook('query:records', records, { collection: ir.collection as CollectionName, ir });
}

/**
 * Reads every matching record.
 */
export function findMany(ir: QueryIR): Promise<QueryRecord[]> {
  return readRows(ir);
}

/**
 * Reads the first matching record, or `undefined` when none match; the read caps at one row.
 */
export async function findFirst(ir: QueryIR): Promise<QueryRecord | undefined> {
  const rows = await readRows({ ...ir, limit: 1 });
  return rows[0];
}
