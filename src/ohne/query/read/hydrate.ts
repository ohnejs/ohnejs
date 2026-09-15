import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { QueryRecord } from './find.ts';

import { groupBy, isNull, isUndefined } from '../../../utils/index.ts';
import { loadBlocks } from './loaders/blocks.ts';
import { loadChildRows } from './loaders/child.ts';
import { loadJunction } from './loaders/records.ts';
import { loadTranslations } from './loaders/translations.ts';

/**
 * A resolver from a parent `UUID` to one field's hydrated value, precomputed over the whole rowset.
 */
type FieldResolver = (parent: string) => unknown;

/**
 * Fully assembles a scope's records from driver rows: column values plus its column-less fields.
 *
 * `fields` is a collection's fields or a composite's subfields.
 * `driverRows` are the rows read from that scope's table, each carrying its fetched columns and `UUID`.
 * Column-less fields - relations, composites, `blocks` lists, `_translations` - load in parallel, batched.
 * Composites recurse into their own subfields, so nesting hydrates to any depth.
 * `locale` scopes the locale-scoped derived tables; nested tables scope through their parent chain.
 * Each field lands in declaration order; `select` narrows which assemble.
 * A `null` select reads every readable field.
 * A `readable: false` field assembles only when `select` names it - the trusted fluent escape hatch.
 * `keepHidden` lifts that skip at every depth.
 * The write machinery's substrate reads set it: a gate may read what no caller-facing read returns.
 * Populate is layered on by the caller: this never swaps a relation's `UUID`s for records.
 */
export async function hydrateScope(
  fields: Record<string, FieldQueryMeta>,
  driverRows: readonly Record<string, SQLValue>[],
  select: readonly string[] | null,
  dialect: Dialect,
  locale: string,
  keepHidden = false,
): Promise<QueryRecord[]> {
  const parents = driverRows.map((row) => row.UUID as string);
  const isSelected = (name: string, field: FieldQueryMeta): boolean =>
    isNull(select) ? keepHidden || field.readable !== false : select.includes(name);

  const resolvers = new Map<string, FieldResolver>();
  await Promise.all(
    Object.entries(fields)
      .filter(([name, field]) => isColumnless(field) && isSelected(name, field))
      .map(async ([name, field]) => {
        resolvers.set(name, await resolveColumnless(field, parents, dialect, locale, keepHidden));
      }),
  );

  return Promise.all(
    driverRows.map(async (row, index) => {
      const record: QueryRecord = {};
      for (const [name, field] of Object.entries(fields)) {
        if (!isSelected(name, field)) continue;
        const resolve = resolvers.get(name);
        record[name] = isUndefined(resolve)
          ? await deserializeColumn(name, field, dialect, row[field.column as string])
          : resolve(parents[index] as string);
      }
      return record;
    }),
  );
}

/**
 * Reads one column back to its domain value: the dialect codec, then the field type's `deserialize` hook.
 * The hook is optional, may be async, and is null-bypassed, so a `null` column never reaches it.
 * `pluck`'s column fast path routes through this too, so both reads return the same value.
 */
export async function deserializeColumn(
  name: string,
  field: FieldQueryMeta,
  dialect: Dialect,
  stored: SQLValue,
): Promise<unknown> {
  const value = dialect.deserialize(field.logicalType as LogicalType, stored);
  const hook = field.fieldType?.deserialize;
  if (isUndefined(hook) || isNull(value)) return value;
  return hook(value, { name, options: (field.options ?? {}) as never });
}

/**
 * Whether a field's value lives outside its scope's table.
 */
function isColumnless(field: FieldQueryMeta): boolean {
  return (
    field.kind === 'records' ||
    field.kind === 'childOne' ||
    field.kind === 'childMany' ||
    field.kind === 'blocks' ||
    field.kind === 'translations'
  );
}

/**
 * Loads one column-less field over the rowset, returning a resolver from parent `UUID` to its value.
 * A `records` resolves to an ordered `UUID[]`; a `blocks` to its ordered `{ block, UUID, fields }` items.
 * A `translations` resolves to the locales holding the record, in configured order, spanning every locale.
 * A composite recurses, regrouping its rows by parent.
 */
async function resolveColumnless(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
  locale: string,
  keepHidden: boolean,
): Promise<FieldResolver> {
  if (field.kind === 'translations') {
    const held = await loadTranslations(field, parents, dialect);
    return (parent) => held[parent] ?? [];
  }
  if (field.kind === 'records') {
    const links = await loadJunction(field, parents, dialect, locale);
    return (parent) => links[parent] ?? [];
  }
  if (field.kind === 'blocks') {
    const items = await loadBlocks(field, parents, dialect, locale, keepHidden);
    return (parent) => items[parent] ?? [];
  }
  const rows = await loadChildRows(field, parents, dialect, locale);
  const items = await hydrateScope(
    field.subfields as Record<string, FieldQueryMeta>,
    rows,
    null,
    dialect,
    locale,
    keepHidden,
  );
  const groups = groupBy(
    items,
    (_item, index) => (rows[index] as Record<string, SQLValue>)._parentUUID as string,
  );
  if (field.kind === 'childOne') return (parent) => groups[parent]?.[0] ?? null;
  return (parent) => groups[parent] ?? [];
}
