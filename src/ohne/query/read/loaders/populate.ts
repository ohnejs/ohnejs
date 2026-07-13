import type { SQLValue } from '../../../database/adapter.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { QueryIR } from '../../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../../metadata.ts';
import type { QueryRecord } from '../find.ts';

import {
  chunk,
  isNull,
  isString,
  isUndefined,
  keyBy,
  uniqueArray,
} from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { queryMetadata } from '../../metadata.ts';
import { scopeColumns } from '../../sql/select.ts';
import { hydrateScope } from '../hydrate.ts';

/**
 * Swaps each populated relation's `UUID`(s) for full target records, in place, depth one.
 *
 * Only selected `record`/`records` fields populate: a field the read did not fetch has none to swap.
 * A `record`'s foreign key becomes the target record or `null`; a `records`' list becomes records.
 * Populated fields load in parallel, each a batched read of its target.
 * The targets are shared references, so the contract holds: do not mutate a populated record.
 */
export async function applyPopulate(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  records: QueryRecord[],
  dialect: Dialect,
): Promise<void> {
  const { select } = ir;
  const fields = uniqueArray(ir.populate).filter((name) => isNull(select) || select.includes(name));
  await Promise.all(
    fields.map((name) =>
      populateField(meta.fields[name] as FieldQueryMeta, name, records, dialect),
    ),
  );
}

/**
 * Populates one relation field across the rowset: gathers its target `UUID`s, reads them once, swaps.
 * A `record` reads its foreign key per row; a `records` flattens every row's list into one batch.
 */
async function populateField(
  field: FieldQueryMeta,
  name: string,
  records: QueryRecord[],
  dialect: Dialect,
): Promise<void> {
  if (field.kind === 'record') {
    const uuids = records.map((record) => record[name]).filter(isString);
    const targets = await loadTargets(field.target as string, uuids, dialect);
    for (const record of records) {
      const uuid = record[name];
      record[name] = isString(uuid) ? (targets[uuid] ?? null) : null;
    }
    return;
  }
  const uuids = records.flatMap((record) => record[name] as string[]);
  const targets = await loadTargets(field.target as string, uuids, dialect);
  for (const record of records) {
    record[name] = (record[name] as string[])
      .map((uuid) => targets[uuid])
      .filter((target): target is QueryRecord => !isUndefined(target));
  }
}

/**
 * Batch-reads full target records for a set of relation links, keyed by `UUID`.
 *
 * Distinct targets read once through `chunk(_, 900)`, each a complete record via the scope assembler.
 * Its own relations stay `UUID`s and its composites hydrate: population is depth one.
 * One row object is shared by every parent that links it, so populated targets are never cloned.
 */
async function loadTargets(
  collection: string,
  uuids: readonly string[],
  dialect: Dialect,
): Promise<Partial<Record<string, QueryRecord>>> {
  const meta = queryMetadata(collection);
  const table = dialect.quote(meta.table);
  const uuid = dialect.quote('UUID');
  const projection = scopeColumns(meta.fields)
    .map((entry) => dialect.quote(entry.column))
    .join(', ');
  const targets: QueryRecord[] = [];
  for (const batch of chunk(uniqueArray(uuids), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await useDatabase().query<Record<string, SQLValue>>(
      `SELECT ${projection} FROM ${table} WHERE ${uuid} IN (${marks})`,
      batch,
    );
    targets.push(...(await hydrateScope(meta.fields, rows, null, dialect)));
  }
  return keyBy(targets, (record) => record.UUID as string);
}
