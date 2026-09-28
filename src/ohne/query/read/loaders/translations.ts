import type { ConditionNode } from '../../../../utils/index.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../../metadata.ts';
import type { QueryRecord } from '../find.ts';

import {
  chunk,
  groupBy,
  intersection,
  isArray,
  isNull,
  mapValues,
  uniqueArray,
} from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { queryLocales } from '../../locale.ts';
import { admittedAt, conditionLocaleSensitive } from '../admitted.ts';

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

/**
 * Narrows each record's `_translations` to the locales where the record meets the access condition.
 *
 * `uuids[i]` keys `records[i]`, so a record narrows whatever its `select` left out.
 * A record without an array `_translations` stays untouched.
 * A condition that reads alike at every locale narrows nothing and probes nothing.
 * Each held locale probes only the records holding it, through `admittedAt` and the read hooks it runs.
 * `unscoped` skips `query:filter` in the probe, as it does in the read.
 */
export async function narrowTranslations(
  meta: CollectionQueryMeta,
  records: readonly QueryRecord[],
  uuids: readonly string[],
  access: ConditionNode | null,
  unscoped = false,
): Promise<void> {
  if (isNull(access) || meta.translatable !== true) return;
  if (!conditionLocaleSensitive(access, meta)) return;
  const listed = records.flatMap((record, index) =>
    isArray<string[]>(record._translations)
      ? [{ record, uuid: uuids[index], held: record._translations }]
      : [],
  );
  const admitted = new Map<string, Set<string>>();
  for (const locale of uniqueArray(listed.flatMap((entry) => entry.held))) {
    const holders = listed
      .filter((entry) => entry.held.includes(locale))
      .map((entry) => entry.uuid);
    admitted.set(locale, await admittedAt(meta.collection, access, holders, locale, unscoped));
  }
  for (const { record, uuid, held } of listed) {
    record._translations = held.filter((locale) => admitted.get(locale)?.has(uuid) === true);
  }
}
