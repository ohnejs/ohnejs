import type { SQLValue } from '../../../database/adapter.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { PopulateNode, QueryIR } from '../../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../../metadata.ts';
import type { QueryRecord } from '../find.ts';

import {
  chunk,
  isNull,
  isString,
  isUndefined,
  keyBy,
  uniqueArray,
} from '../../../../utils/index.ts';
import { useDatabase } from '../../../database/use-database.ts';
import { effectiveLocale } from '../../locale.ts';
import { queryMetadata } from '../../metadata.ts';
import { compileFrom } from '../../sql/from.ts';
import { scopeColumns } from '../../sql/select.ts';
import { hydrateScope } from '../hydrate.ts';

/**
 * Swaps each populated relation's `UUID`(s) for hydrated target records, in place, down the tree.
 *
 * Only selected `record`/`records` fields populate: a field the read did not fetch has none to swap.
 * A node's subselect narrows what its targets carry; its children recurse the same rules one level down.
 * A `record`'s foreign key becomes the target record or `null`; a `records`' list becomes records.
 * A translatable target reads at the query's locale at every depth, its untranslated fields `null`.
 * Sibling nodes load in parallel, each a batched read of its own target set.
 * The targets are shared references within a node, so the contract holds: do not mutate a populated record.
 */
export async function applyPopulate(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  records: QueryRecord[],
  dialect: Dialect,
): Promise<void> {
  const { select } = ir;
  const locale = effectiveLocale(ir.locale);
  const nodes = ir.populate.filter((node) => isNull(select) || select.includes(node.field));
  await populateNodes(nodes, meta, records, dialect, locale);
}

/**
 * Populates one level's nodes over a rowset in parallel, each node one batched read of its target.
 */
async function populateNodes(
  nodes: readonly PopulateNode[],
  meta: CollectionQueryMeta,
  records: QueryRecord[],
  dialect: Dialect,
  locale: string,
): Promise<void> {
  await Promise.all(
    nodes.map((node) =>
      populateField(meta.fields[node.field] as FieldQueryMeta, node, records, dialect, locale),
    ),
  );
}

/**
 * Populates one relation field across the rowset: gathers its target `UUID`s, reads them once, swaps.
 * A `record` reads its foreign key per row; a `records` flattens every row's list into one batch.
 * A dangling link keeps its shape: a `record` swaps to `null`, a `records` element drops.
 */
async function populateField(
  field: FieldQueryMeta,
  node: PopulateNode,
  records: QueryRecord[],
  dialect: Dialect,
  locale: string,
): Promise<void> {
  if (field.kind === 'record') {
    const uuids = records.map((record) => record[node.field]).filter(isString);
    const targets = await loadTargets(field.target as string, uuids, node, dialect, locale);
    for (const record of records) {
      const uuid = record[node.field];
      record[node.field] = isString(uuid) ? (targets[uuid] ?? null) : null;
    }
    return;
  }
  const uuids = records.flatMap((record) => record[node.field] as string[]);
  const targets = await loadTargets(field.target as string, uuids, node, dialect, locale);
  for (const record of records) {
    record[node.field] = (record[node.field] as string[])
      .map((uuid) => targets[uuid])
      .filter((target): target is QueryRecord => !isUndefined(target));
  }
}

/**
 * Batch-reads a node's target records for a set of relation links, keyed by `UUID`.
 *
 * Distinct targets read once through `chunk(_, 900)`, each assembled by the scope assembler.
 * The node's subselect narrows the projection and hydration to exactly its named fields.
 * The companion joins only when a named subfield needs it.
 * `UUID` is always fetched for keying and child correlation.
 * When the subselect leaves `UUID` unnamed, it strips - strictly after `keyBy`.
 * The node's children recurse over the deduped targets, so a shared target hydrates once.
 * A child not named in the subselect drops, exactly as an unselected top-level populate does.
 * One row object is shared by every parent that links it, so populated targets are never cloned.
 */
async function loadTargets(
  collection: string,
  uuids: readonly string[],
  node: PopulateNode,
  dialect: Dialect,
  locale: string,
): Promise<Partial<Record<string, QueryRecord>>> {
  const meta = queryMetadata(collection);
  const named = node.select;
  const fetched = scopeColumns(meta.fields).filter(
    (entry) => isNull(named) || named.includes(entry.name) || entry.name === 'UUID',
  );
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const from = compileFrom(meta, { fields: fetched.map((entry) => entry.name) }, locale, dialect);
  const projection = fetched.map((entry) => dialect.quote(entry.column)).join(', ');
  const hydrated = isNull(named) ? null : [...named, 'UUID'];
  const targets: QueryRecord[] = [];
  for (const batch of chunk(uniqueArray(uuids), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await useDatabase().query<Record<string, SQLValue>>(
      `SELECT ${projection} ${from.sql} WHERE ${uuid} IN (${marks})`,
      [...from.params, ...batch],
    );
    targets.push(...(await hydrateScope(meta.fields, rows, hydrated, dialect, locale)));
  }
  const keyed = keyBy(targets, (record) => record.UUID as string);
  const children = node.children.filter((child) => isNull(named) || named.includes(child.field));
  await populateNodes(children, meta, targets, dialect, locale);
  if (!isNull(named) && !named.includes('UUID')) {
    for (const target of targets) delete target.UUID;
  }
  return keyed;
}
