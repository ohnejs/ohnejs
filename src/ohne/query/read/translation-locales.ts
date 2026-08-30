import { intersection, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { queryLocales } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';

/**
 * Lists the locales at which one record holds a translation, in the configured locale order.
 *
 * A locale holds a translation when any row exists for the record there.
 * The probe spans the companion table and every owned locale-scoped derived table.
 * Rows at a locale the configuration no longer names never surface.
 * A non-translatable collection throws - no locale could hold anything.
 */
export async function translationLocales(collection: string, uuid: string): Promise<string[]> {
  const meta = queryMetadata(collection);
  if (meta.translatable !== true) {
    throw ohneError({
      title: `Cannot list translation locales on \`${collection}\``,
      body: [
        `Collection \`${collection}\` has no translatable field, so no locale holds a translation.`,
      ],
    });
  }
  const dialect = useDialect();
  const database = useDatabase();
  const tables = [
    ...(isUndefined(meta.companionTable) ? [] : [meta.companionTable]),
    ...Object.values(meta.fields)
      .filter((field) => field.localeScoped === true && field.inverse !== true)
      .map((field) => field.table as string),
  ];
  const held = new Set<string>();
  for (const table of tables) {
    const rows = await database.query<{ _localeCode: string }>(
      `SELECT DISTINCT ${dialect.quote('_localeCode')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} = ?`,
      [uuid],
    );
    for (const row of rows) held.add(row._localeCode);
  }
  return intersection(queryLocales().locales, [...held]);
}
