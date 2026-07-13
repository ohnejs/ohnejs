import type { Dialect } from '../../../database/dialect.ts';
import type { FieldQueryMeta } from '../../metadata.ts';

import { chunk, groupBy, mapValues } from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';

/**
 * Loads one `records` relation's links, keyed by the owning record's `UUID` to an ordered `UUID[]`.
 *
 * The owner side reads the junction by `_parentUUID`, ordered by `_parentPosition`, listing targets.
 * The inverse side swaps the roles: it reads by `_targetUUID`, ordered by `_targetPosition`.
 * So both sides read their own authored order.
 * Parents batch through `chunk(_, 900)`, so the junction is at most one read per chunk.
 * A parent with no links is absent from the result; the caller reads that as an empty list.
 */
export async function loadJunction(
  field: FieldQueryMeta,
  parents: readonly string[],
  dialect: Dialect,
): Promise<Partial<Record<string, string[]>>> {
  const inverse = field.inverse === true;
  const table = dialect.quote(field.table as string);
  const self = dialect.quote(inverse ? '_targetUUID' : '_parentUUID');
  const link = dialect.quote(inverse ? '_parentUUID' : '_targetUUID');
  const order = dialect.quote(inverse ? '_targetPosition' : '_parentPosition');

  const rows: { self: string; link: string }[] = [];
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const found = await useDatabase().query<{ self: string; link: string }>(
      `SELECT ${self} AS "self", ${link} AS "link" FROM ${table} ` +
        `WHERE ${self} IN (${marks}) ORDER BY ${order}`,
      batch,
    );
    rows.push(...found);
  }

  const grouped = groupBy(rows, (row) => row.self);
  return mapValues(grouped, (_parent, group) => (group ?? []).map((row) => row.link));
}
