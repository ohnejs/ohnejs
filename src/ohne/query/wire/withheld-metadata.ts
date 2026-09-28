import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';

import { isNull, parseCondition } from '../../../utils/index.ts';
import { conditionLocaleSensitive } from '../read/admitted.ts';

/**
 * Whether a scope `where` can admit a record at one locale and hide it at another.
 * An unparsable condition counts as sensitive; the read it scopes refuses it anyway.
 */
export function localeSensitive(where: ConditionInput, meta: CollectionQueryMeta): boolean {
  const parsed = parseCondition(where);
  return !parsed.ok || conditionLocaleSensitive(parsed.node, meta);
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
