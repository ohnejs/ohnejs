import type { SQLValue } from '../../../database/adapter.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { FieldQueryMeta } from '../../metadata.ts';
import type { QueryRecord } from '../find.ts';

import {
  chunk,
  groupBy,
  isUndefined,
  keyBy,
  mapValues,
  uniqueArray,
} from '../../../../utils/index.ts';
import { blockTableName } from '../../../database/naming/table-names.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { ohneError } from '../../../error/ohne-error.ts';
import { blockQueryMetadata } from '../../metadata.ts';
import { scopeColumns } from '../../sql/select.ts';
import { hydrateScope } from '../hydrate.ts';

/**
 * One wrapper row: the placement of one block instance under one parent, at one position.
 */
interface WrapperRow {
  UUID: string;
  _parentUUID: string;
  _parentPosition: number;
  _blockType: string;
  _blockUUID: string;
}

/**
 * Loads one `blocks` field over a batch of parents, keyed by parent `UUID` to its ordered items.
 *
 * Wrapper rows read by `_parentUUID` in `chunk(_, 900)` batches, ordered by `_parentPosition`.
 * A parent's rows live in one chunk, so grouping per parent keeps each list's order.
 * A locale-scoped wrapper holds one block list per (parent, locale), so the read binds `locale`.
 * Each block type present then reads its shared table once over the distinct instance ids.
 * Hydration runs through the scope assembler, so nested composites, relations, and blocks recurse.
 * Items assemble in wrapper order as `{ block, UUID, fields }`.
 * Each carries the type, the instance id lifted out of the hydrated record, and the remaining fields.
 * Items assemble fresh per wrapper row - the `_blockUUID` unique bars sharing - never cross-parent.
 * A parent with no rows is absent from the result; the caller reads that as an empty list.
 * `keepHidden` lifts the `readable: false` skip, for the write machinery's substrate reads.
 * A wrapper row referencing a missing instance throws.
 * A dangling link is corruption, never silently dropped content.
 */
export async function loadBlocks(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
  locale: string,
  keepHidden = false,
): Promise<Partial<Record<string, QueryRecord[]>>> {
  const wrappers = await loadWrapperRows(field, parents, dialect, locale);
  const byType = groupBy(wrappers, (row) => row._blockType);
  const instances = new Map<string, Partial<Record<string, QueryRecord>>>();
  await Promise.all(
    Object.entries(byType).map(async ([type, rows]) => {
      const ids = uniqueArray((rows ?? []).map((row) => row._blockUUID));
      instances.set(type, await loadInstances(type, ids, dialect, locale, keepHidden));
    }),
  );
  const grouped = groupBy(wrappers, (row) => row._parentUUID);
  return mapValues(grouped, (_parent, rows) =>
    (rows ?? []).map((row) => assembleItem(field, row, instances)),
  );
}

/**
 * Reads the wrapper rows of every parent in the batch, ordered by position within each parent.
 */
async function loadWrapperRows(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
  locale: string,
): Promise<WrapperRow[]> {
  const table = dialect.quote(field.table as string);
  const parent = dialect.quote('_parentUUID');
  const projection = ['UUID', '_parentUUID', '_parentPosition', '_blockType', '_blockUUID']
    .map((column) => dialect.quote(column))
    .join(', ');
  const scoped = field.localeScoped === true;
  const filter = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
  const order = ` ORDER BY ${dialect.quote('_parentPosition')}`;

  const rows: WrapperRow[] = [];
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const found = await useDatabase().query<WrapperRow>(
      `SELECT ${projection} FROM ${table} WHERE ${parent} IN (${marks})${filter}${order}`,
      scoped ? [...batch, locale] : [...batch],
    );
    rows.push(...found);
  }
  return rows;
}

/**
 * Batch-reads and hydrates one block type's instances, keyed by instance `UUID`.
 * The recursion through the scope assembler hydrates whatever the block nests, blocks included.
 * An unregistered type throws in `blockQueryMetadata`.
 */
async function loadInstances(
  type: string,
  ids: readonly string[],
  dialect: Dialect,
  locale: string,
  keepHidden: boolean,
): Promise<Partial<Record<string, QueryRecord>>> {
  const meta = blockQueryMetadata(type);
  const table = dialect.quote(meta.table);
  const uuid = dialect.quote('UUID');
  const projection = scopeColumns(meta.fields)
    .map((entry) => dialect.quote(entry.column))
    .join(', ');
  const records: QueryRecord[] = [];
  for (const batch of chunk(ids, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await useDatabase().query<Record<string, SQLValue>>(
      `SELECT ${projection} FROM ${table} WHERE ${uuid} IN (${marks})`,
      [...batch],
    );
    records.push(...(await hydrateScope(meta.fields, rows, null, dialect, locale, keepHidden)));
  }
  return keyBy(records, (record) => record.UUID as string);
}

/**
 * Wraps one hydrated instance into its `{ block, UUID, fields }` envelope.
 * A wrapper row whose instance row is gone throws: a dangling reference is corruption, never skipped.
 */
function assembleItem(
  field: FieldQueryMeta,
  row: WrapperRow,
  instances: Map<string, Partial<Record<string, QueryRecord>>>,
): QueryRecord {
  const record = instances.get(row._blockType)?.[row._blockUUID];
  if (isUndefined(record)) {
    throw ohneError({
      title: `Dangling block reference in \`${field.table}\``,
      body: [
        `Row \`${row.UUID}\` places block \`${row._blockType}\` instance \`${row._blockUUID}\`, but \`${blockTableName(row._blockType)}\` holds no such row.`,
        '',
        'This is corruption or an unsynced schema; repair or remove the wrapper row.',
      ],
    });
  }
  const { UUID, ...fields } = record;
  return { block: row._blockType, UUID, fields };
}
