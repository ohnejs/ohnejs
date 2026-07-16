import type { ConditionNode } from '../../../utils/index.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { OrderEntry } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { rawFragment, type SQLFragment } from './fragment.ts';

/**
 * The statement pieces a `FROM` decision reads: whichever a read compiles, `null`/absent when unused.
 * `fields` are the projected or plucked field names; `null` stands for the full record.
 */
interface FromParts {
  fields?: readonly string[] | null;
  condition?: ConditionNode | null;
  order?: readonly OrderEntry[];
}

/**
 * Compiles the `FROM` clause of a top-level read, joining the companion when the statement needs it.
 *
 * A statement touching no companion column reads the main table alone.
 * One touching any joins `LEFT JOIN <companion> ON _parentUUID = UUID AND _localeCode = ?`.
 * A record without a translation therefore still reads, its companion columns `NULL`.
 * The locale predicate lives in the `ON` clause: a `WHERE`-side filter would drop untranslated rows.
 * Companion and main columns are disjoint by construction, so references stay bare and unambiguous.
 */
export function compileFrom(
  meta: CollectionQueryMeta,
  parts: FromParts,
  locale: string,
  dialect: Dialect,
): SQLFragment {
  const main = dialect.quote(meta.table);
  if (isUndefined(meta.companionTable) || !usesCompanion(meta.fields, parts)) {
    return rawFragment(`FROM ${main}`);
  }
  const companion = dialect.quote(meta.companionTable);
  const parent = `${companion}.${dialect.quote('_parentUUID')} = ${main}.${dialect.quote('UUID')}`;
  const scoped = `${companion}.${dialect.quote('_localeCode')} = ?`;
  return {
    sql: `FROM ${main} LEFT JOIN ${companion} ON ${parent} AND ${scoped}`,
    params: [locale],
  };
}

/**
 * Whether any of a statement's pieces addresses a companion-resident column.
 */
function usesCompanion(fields: Record<string, FieldQueryMeta>, parts: FromParts): boolean {
  if (!isUndefined(parts.fields)) {
    if (isNull(parts.fields)) {
      if (Object.values(fields).some((field) => field.companion === true)) return true;
    } else if (parts.fields.some((name) => fields[name]?.companion === true)) return true;
  }
  if (!isUndefined(parts.condition) && !isNull(parts.condition)) {
    if (conditionUsesCompanion(parts.condition, fields)) return true;
  }
  return (parts.order ?? []).some((entry) => fields[entry.field]?.companion === true);
}

/**
 * Whether a condition addresses a companion-resident column of `fields` at its own level.
 * `has`/`empty` on a companion `record` count - their foreign key lives on the companion.
 * Nested conditions never count: an `EXISTS` subquery joins its own target's companion.
 */
export function conditionUsesCompanion(
  node: ConditionNode,
  fields: Record<string, FieldQueryMeta>,
): boolean {
  switch (node.kind) {
    case 'and':
    case 'or':
      return node.nodes.some((child) => conditionUsesCompanion(child, fields));
    case 'compare':
    case 'has':
    case 'empty':
      return fields[node.path[0]]?.companion === true;
  }
}
