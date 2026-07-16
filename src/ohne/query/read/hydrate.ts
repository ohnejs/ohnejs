import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { QueryRecord } from './find.ts';

import { groupBy, isNull, isUndefined } from '../../../utils/index.ts';
import { loadBlocks } from './loaders/blocks.ts';
import { loadChildRows } from './loaders/child.ts';
import { loadJunction } from './loaders/records.ts';

/**
 * A resolver from a parent `UUID` to one field's hydrated value, precomputed over the whole rowset.
 */
type FieldResolver = (parent: string) => unknown;

/**
 * Fully assembles a scope's records from driver rows: column values plus its column-less fields.
 *
 * `fields` is a collection's fields or a composite's subfields.
 * `driverRows` are the rows read from that scope's table, each carrying its fetched columns and `UUID`.
 * Column-less fields - `records` relations, composites, and `blocks` lists - load in parallel, batched.
 * Composites recurse into their own subfields, so nesting hydrates to any depth.
 * `locale` scopes the locale-scoped derived tables; nested tables scope through their parent chain.
 * Each field lands in declaration order; `select` narrows which assemble (`null` reads them all).
 * Populate is layered on by the caller: this never swaps a relation's `UUID`s for records.
 */
export async function hydrateScope(
  fields: Record<string, FieldQueryMeta>,
  driverRows: readonly Record<string, SQLValue>[],
  select: readonly string[] | null,
  dialect: Dialect,
  locale: string,
): Promise<QueryRecord[]> {
  const parents = driverRows.map((row) => row.UUID as string);
  const isSelected = (name: string): boolean => isNull(select) || select.includes(name);

  const resolvers = new Map<string, FieldResolver>();
  await Promise.all(
    Object.entries(fields)
      .filter(([name, field]) => isColumnless(field) && isSelected(name))
      .map(async ([name, field]) => {
        resolvers.set(name, await resolveColumnless(field, parents, dialect, locale));
      }),
  );

  return driverRows.map((row, index) => {
    const record: QueryRecord = {};
    for (const [name, field] of Object.entries(fields)) {
      if (!isSelected(name)) continue;
      const resolve = resolvers.get(name);
      record[name] = isUndefined(resolve)
        ? deserializeColumn(name, field, dialect, row[field.column as string])
        : resolve(parents[index] as string);
    }
    return record;
  });
}

/**
 * Reads one column back to its domain value: the dialect codec, then the field type's `deserialize` hook.
 * The hook is optional and null-bypassed, so a `null` column never reaches it.
 */
function deserializeColumn(
  name: string,
  field: FieldQueryMeta,
  dialect: Dialect,
  stored: SQLValue,
): unknown {
  const value = dialect.deserialize(field.logicalType as LogicalType, stored);
  const hook = field.fieldType?.deserialize;
  if (isUndefined(hook) || isNull(value)) return value;
  return hook(value, { name, options: (field.options ?? {}) as never });
}

/**
 * Whether a field's value lives outside its scope's table:
 * a `records` relation, a child composite, or a `blocks` list.
 */
function isColumnless(field: FieldQueryMeta): boolean {
  return (
    field.kind === 'records' ||
    field.kind === 'childOne' ||
    field.kind === 'childMany' ||
    field.kind === 'blocks'
  );
}

/**
 * Loads one column-less field over the rowset, returning a resolver from parent `UUID` to its value.
 * A `records` resolves to an ordered `UUID[]`; a `blocks` to its ordered `{ block, UUID, fields }` items.
 * A composite recurses, regrouping its rows by parent.
 */
async function resolveColumnless(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
  locale: string,
): Promise<FieldResolver> {
  if (field.kind === 'records') {
    const links = await loadJunction(field, parents, dialect, locale);
    return (parent) => links[parent] ?? [];
  }
  if (field.kind === 'blocks') {
    const items = await loadBlocks(field, parents, dialect, locale);
    return (parent) => items[parent] ?? [];
  }
  const rows = await loadChildRows(field, parents, dialect, locale);
  const items = await hydrateScope(
    field.subfields as Record<string, FieldQueryMeta>,
    rows,
    null,
    dialect,
    locale,
  );
  const groups = groupBy(
    items,
    (_item, index) => (rows[index] as Record<string, SQLValue>)._parentUUID as string,
  );
  if (field.kind === 'childOne') return (parent) => groups[parent]?.[0] ?? null;
  return (parent) => groups[parent] ?? [];
}
