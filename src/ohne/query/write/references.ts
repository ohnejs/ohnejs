import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { RelationRef } from '../pipeline/run-record.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, groupBy, uniqueArray } from '../../../utils/index.ts';
import { collectionTableName } from '../../database/naming/table-names.ts';

/**
 * Proves every referenced row exists, one batched probe per target collection.
 *
 * References group by target, dedupe, and chunk through `chunk(_, 900)`, so a target is a few reads at most.
 * A `UUID` the probe does not return errors at its exact dot-path, so a missing link reads where it sits.
 * Returns an `invalidReference` message keyed by each dangling path, or an empty map when all resolve.
 */
export async function checkReferences(
  tx: Transaction,
  dialect: Dialect,
  refs: readonly RelationRef[],
): Promise<FieldErrors> {
  if (refs.length === 0) return {};

  const byTarget = groupBy(refs, (ref) => ref.target);
  const errors: FieldErrors = {};
  for (const [target, group = []] of Object.entries(byTarget)) {
    const table = dialect.quote(collectionTableName(target));
    const uuids = uniqueArray(group.map((ref) => ref.uuid));
    const found = new Set<string>();
    for (const batch of chunk(uuids, 900)) {
      const marks = batch.map(() => '?').join(', ');
      const rows = await tx.query<{ UUID: string }>(
        `SELECT ${dialect.quote('UUID')} FROM ${table} WHERE ${dialect.quote('UUID')} IN (${marks})`,
        batch,
      );
      for (const row of rows) found.add(row.UUID);
    }
    for (const ref of group) {
      if (!found.has(ref.uuid)) errors[ref.path] = 'validation.invalidReference';
    }
  }
  return errors;
}
