import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { FieldWriteContext } from '../../fields/context.ts';
import type { RelationRef } from '../pipeline/run-record.ts';
import type { ReachResolver } from '../wire/reach.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, groupBy, isUndefined, uniqueArray } from '../../../utils/index.ts';
import { collectionTableName } from '../../database/naming/table-names.ts';
import { queryMetadata } from '../metadata.ts';
import { admittedUUIDs } from '../wire/admitted.ts';

/**
 * The reach a write checks the links its input provides against.
 */
export interface LinkReach {
  /**
   * Answers the caller's read reach into each linked collection.
   */
  resolve: ReachResolver;

  /**
   * The write's effective locale, the one a translatable target's scope `where` reads at.
   */
  locale: string;
}

/**
 * Proves every referenced row exists, one batched probe per target collection.
 *
 * References group by target, dedupe, and chunk through `chunk(_, 900)`, so a target is a few reads at most.
 * A `UUID` the probe does not return errors at its exact dot-path, so a missing link reads where it sits.
 * Without `reach` existence is all a link needs.
 * With it, a `provided` link must also be one the reach admits, and a hidden one fails as a missing one.
 * The reach resolves for every target a provided link names, found or not, so a throw answers both alike.
 * Returns an `invalidReference` message keyed by each failing path, or an empty map when all resolve.
 */
export async function checkReferences(
  tx: Transaction,
  dialect: Dialect,
  refs: readonly RelationRef[],
  reach?: LinkReach,
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
    const provided = group.filter((ref) => ref.provided);
    const linked = uniqueArray(
      provided.filter((ref) => found.has(ref.uuid)).map((ref) => ref.uuid),
    );
    const admitted =
      isUndefined(reach) || provided.length === 0
        ? found
        : await linkAdmitted(reach, target, linked);
    for (const ref of group) {
      if (!(ref.provided ? admitted : found).has(ref.uuid)) {
        errors[ref.path] = 'validation.invalidReference';
      }
    }
  }
  return errors;
}

/**
 * The `reachable` a write hands its fields: every `UUID` without a `reach`, the admitted ones with it.
 */
export function linkReachable(reach?: LinkReach): FieldWriteContext['reachable'] {
  if (isUndefined(reach)) return async (_target, uuids) => new Set(uuids);
  return (target, uuids) => linkAdmitted(reach, target, uuids);
}

/**
 * The `UUID`s among `uuids` the reach admits in `target`, through its scope `where` alone.
 */
async function linkAdmitted(
  reach: LinkReach,
  target: string,
  uuids: readonly string[],
): Promise<Set<string>> {
  const scope = await reach.resolve(target);
  if (scope === false || uuids.length === 0) return new Set();
  if (isUndefined(scope.where)) return new Set(uuids);
  const meta = queryMetadata(target);
  const locale = meta.translatable === true ? reach.locale : null;
  return admittedUUIDs(target, meta, scope.where, uuids, locale);
}
