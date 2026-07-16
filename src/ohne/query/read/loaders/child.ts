import type { SQLValue } from '../../../database/adapter.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { FieldQueryMeta } from '../../metadata.ts';

import { chunk } from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { scopeColumns } from '../../sql/select.ts';

/**
 * Reads the child rows of one `object`/`repeater` field over a batch of parents, flat and ordered.
 *
 * Every subfield column is fetched, plus the child's own `UUID` and its `_parentUUID` anchor.
 * A `repeater` also fetches and orders by `_parentPosition`, so a parent's items keep their order.
 * A locale-scoped child table holds one item set per (parent, locale), so the read binds `locale`.
 * Nested child tables carry no `_localeCode` and scope through their parent chain.
 * Parents batch through `chunk(_, 900)`, so the child table is at most one read per chunk.
 * The rows return raw for the caller to assemble and regroup, keyed by the `_parentUUID` anchor.
 * Nested composites and relations hydrate there, over the child scope's own subfields.
 */
export async function loadChildRows(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
  locale: string,
): Promise<Record<string, SQLValue>[]> {
  const many = field.kind === 'childMany';
  const table = dialect.quote(field.table as string);
  const parent = dialect.quote('_parentUUID');
  const columns = scopeColumns(field.subfields as Record<string, FieldQueryMeta>).map((entry) =>
    dialect.quote(entry.column),
  );
  columns.push(parent);
  if (many) columns.push(dialect.quote('_parentPosition'));
  const projection = columns.join(', ');
  const scoped = field.localeScoped === true;
  const filter = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
  const order = many ? ` ORDER BY ${dialect.quote('_parentPosition')}` : '';

  const rows: Record<string, SQLValue>[] = [];
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const found = await useDatabase().query<Record<string, SQLValue>>(
      `SELECT ${projection} FROM ${table} WHERE ${parent} IN (${marks})${filter}${order}`,
      scoped ? [...batch, locale] : [...batch],
    );
    rows.push(...found);
  }
  return rows;
}
