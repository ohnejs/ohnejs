import type { Dialect } from '../../../database/dialect.ts';
import type { FieldQueryMeta } from '../../metadata.ts';

import { chunk, groupBy, intersection, mapValues } from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { queryLocales } from '../../locale.ts';

/**
 * Loads the locales each record holds a translation at, keyed by the record's `UUID` to a `string[]`.
 *
 * A locale holds a translation when any row exists for the record there.
 * The probe spans every table in `field.tables`: the companion, then each owned locale-scoped derived table.
 * Each list follows the configured locale order.
 * A row at a locale the configuration no longer names never surfaces.
 * No locale binds: the field spans every locale at once.
 * Parents batch through `chunk(_, 900)`, so each table is at most one read per chunk.
 * A parent with no rows anywhere is absent from the result; the caller reads that as an empty list.
 */
export async function loadTranslations(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
): Promise<Partial<Record<string, string[]>>> {
  const parent = dialect.quote('_parentUUID');
  const locale = dialect.quote('_localeCode');

  const rows: { parent: string; locale: string }[] = [];
  for (const table of field.tables as readonly string[]) {
    for (const batch of chunk(parents, 900)) {
      const marks = batch.map(() => '?').join(', ');
      const found = await useDatabase().query<{ parent: string; locale: string }>(
        `SELECT DISTINCT ${parent} AS "parent", ${locale} AS "locale" ` +
          `FROM ${dialect.quote(table)} WHERE ${parent} IN (${marks})`,
        [...batch],
      );
      rows.push(...found);
    }
  }

  const { locales } = queryLocales();
  const grouped = groupBy(rows, (row) => row.parent);
  return mapValues(grouped, (_parent, group) =>
    intersection(
      locales,
      (group ?? []).map((row) => row.locale),
    ),
  );
}
