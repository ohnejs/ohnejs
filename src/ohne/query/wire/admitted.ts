import type { CollectionQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';

import { toConditionNode } from '../impl.ts';
import { admittedAt } from '../read/admitted.ts';

/**
 * The `UUID`s among `uuids` the scope `where` admits at one locale; `null` reads the default locale.
 * It probes through `admittedAt`, the same read that narrows a record's `_translations`.
 */
export function admittedUUIDs(
  collection: string,
  meta: CollectionQueryMeta,
  where: ConditionInput,
  uuids: readonly string[],
  locale: string | null,
): Promise<Set<string>> {
  return admittedAt(collection, toConditionNode(where, meta), uuids, locale);
}
