import type { CollectionQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';

import { chunk, isNull } from '../../../utils/index.ts';
import { queryUntyped } from '../query.ts';
import { applyQuery } from './apply.ts';
import { resolveGuards } from './guards.ts';
import { parseQueryParams } from './parse.ts';

/**
 * The `UUID`s among `uuids` the scope `where` admits at one locale; `null` reads the default locale.
 * The locale probes once per chunk, selecting `UUID` alone under `{ where }`.
 * The scope's `select` would drop the key and its `limit` would cap the probe, so neither rides.
 */
export async function admittedUUIDs(
  collection: string,
  meta: CollectionQueryMeta,
  where: ConditionInput,
  uuids: readonly string[],
  locale: string | null,
): Promise<Set<string>> {
  const admitted = new Set<string>();
  const parsed = parseQueryParams(
    isNull(locale) ? { select: 'UUID' } : { select: 'UUID', locale },
    meta,
    resolveGuards(),
  );
  for (const batch of chunk(uuids, 900)) {
    const builder = queryUntyped(collection).where({ UUID: { in: batch } });
    const rows = await applyQuery(builder, parsed, { where }).limit(batch.length).findMany();
    for (const row of rows) admitted.add(row.UUID as string);
  }
  return admitted;
}
