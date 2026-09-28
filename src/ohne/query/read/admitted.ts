import type { ConditionNode } from '../../../utils/index.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { chunk, walkCondition } from '../../../utils/index.ts';
import { readRows } from './find.ts';

/**
 * Whether a parsed scope condition can admit a record at one locale and hide it at another.
 * A leaf over a companion field reads that locale's value; a `has` or `empty` reaches per-locale rows.
 * A condition over plain columns alone answers alike at every locale, and so does one over `_translations`.
 */
export function conditionLocaleSensitive(node: ConditionNode, meta: CollectionQueryMeta): boolean {
  let sensitive = false;
  walkCondition(node, (child) => {
    if (child.kind === 'has' || child.kind === 'empty') sensitive = true;
    else if (child.kind === 'compare' && meta.fields[child.path[0]]?.companion === true) {
      sensitive = true;
    }
  });
  return sensitive;
}

/**
 * The `UUID`s among `uuids` the condition admits at one locale; `null` reads the default locale.
 * Each chunk of 900 is one read selecting `UUID` alone, through every read hook a scoped read runs.
 * A hook that hides a record at a locale hides it from the probe too.
 * `unscoped` skips `query:filter`, matching a read that skips it.
 */
export async function admittedAt(
  collection: string,
  condition: ConditionNode,
  uuids: readonly string[],
  locale: string | null,
  unscoped = false,
): Promise<Set<string>> {
  const admitted = new Set<string>();
  for (const batch of chunk(uuids, 900)) {
    const keyed = {
      kind: 'compare',
      path: ['UUID'],
      op: 'in',
      value: batch,
      negated: false,
    } as const;
    const rows = await readRows({
      collection,
      condition: { kind: 'and', nodes: [condition, keyed] },
      select: ['UUID'],
      order: [],
      limit: null,
      offset: null,
      populate: [],
      locale,
      access: null,
      wire: null,
      unscoped,
    });
    for (const row of rows) admitted.add(row.UUID as string);
  }
  return admitted;
}
