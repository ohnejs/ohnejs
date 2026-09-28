import type { ConditionNode } from '../../../utils/index.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';

import { isNull, parseCondition, walkCondition } from '../../../utils/index.ts';

/**
 * Whether a scope `where` can admit a record at one locale and hide it at another.
 * An unparsable condition counts as sensitive; the read it scopes refuses it anyway.
 */
export function localeSensitive(where: ConditionInput, meta: CollectionQueryMeta): boolean {
  const parsed = parseCondition(where);
  return !parsed.ok || conditionLocaleSensitive(parsed.node, meta);
}

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
 * The metadata an untrusted query parses against once a scope withholds part of the collection.
 * A field outside `select` reads as hidden, so the parser refuses it exactly as an unknown field.
 * `sealed` marks `_translations` as `narrowed`, so it stays selectable but admits no operator.
 * A locale-sensitive scope seals: a filter reads the stored rows, and would reveal a locale the scope hides.
 */
export function withheldMetadata(
  meta: CollectionQueryMeta,
  select: readonly string[] | null,
  sealed: boolean,
): CollectionQueryMeta {
  if (isNull(select) && !sealed) return meta;
  const visible = isNull(select) ? null : new Set(select);
  const fields: Record<string, FieldQueryMeta> = Object.create(null);
  for (const [name, entry] of Object.entries(meta.fields)) {
    if (!isNull(visible) && !visible.has(name)) fields[name] = { ...entry, readable: false };
    else if (sealed && entry.kind === 'translations') fields[name] = { ...entry, narrowed: true };
    else fields[name] = entry;
  }
  return { ...meta, fields };
}
