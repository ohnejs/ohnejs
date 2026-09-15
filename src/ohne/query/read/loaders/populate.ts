import type { CollectionName } from '../../../collections/known-collections.ts';
import type { SQLValue } from '../../../database/adapter.ts';
import type { Dialect } from '../../../database/dialect.ts';
import type { PopulateNode, QueryIR, TargetReach } from '../../ir.ts';
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
import { applyHook } from '../../../hooks/apply-hook.ts';
import { useHooks } from '../../../hooks/use-hooks.ts';
import { effectiveLocale } from '../../locale.ts';
import { queryMetadata } from '../../metadata.ts';
import { compileFrom } from '../../sql/from.ts';
import { scopeColumns } from '../../sql/select.ts';
import { compileWhere } from '../../sql/where.ts';
import { hydrateScope } from '../hydrate.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters a populate node's freshly batch-read target records before they key back onto their parents.
     * Fires once per node's batched read, after the target rows assemble and before they are keyed by `UUID`.
     * Drop a soft-deleted or unauthorized target here.
     * A dropped target leaves a `record` link `null`, and removes a `records` element.
     * The node's children recurse over the surviving set, so a filtered target hides its whole subtree.
     * The `context` carries the populate `node` and its target `collection`.
     * Return the filtered `QueryRecord[]`, or nothing to keep every target.
     * It never sees junction `UUID` lists, child composites, or blocks; those load outside the populate path.
     */
    'populate:targets': (
      targets: QueryRecord[],
      context: { node: PopulateNode; collection: CollectionName },
    ) => void | QueryRecord[] | Promise<void | QueryRecord[]>;
  }
}

/**
 * The select a populated scope hydrates under.
 * A `null` select stays `null` unless a node populates a `readable: false` relation.
 * A populate is an explicit ask, exactly as a select naming the field is.
 * The hidden relation's links must therefore assemble, or the swap would have nothing to work on.
 */
export function populatedSelect(
  select: readonly string[] | null,
  fields: Record<string, FieldQueryMeta>,
  nodes: readonly PopulateNode[],
): readonly string[] | null {
  if (!isNull(select)) return select;
  const hidden = nodes.filter((node) => fields[node.field]?.readable === false);
  if (hidden.length === 0) return null;
  return [
    ...Object.keys(fields).filter((name) => fields[name].readable !== false),
    ...hidden.map((node) => node.field),
  ];
}

/**
 * Swaps each populated relation's `UUID`(s) for hydrated target records, in place, down the tree.
 *
 * Only selected `record`/`records` fields populate: a field the read did not fetch has none to swap.
 * A node's subselect narrows what its targets carry; its children recurse the same rules one level down.
 * A `record`'s foreign key becomes the target record or `null`; a `records`' list becomes records.
 * A translatable target reads at the query's locale at every depth, its untranslated fields `null`.
 * Sibling nodes load in parallel, each a batched read of its own target set.
 * The targets are shared references within a node, so the contract holds: do not mutate a populated record.
 * A wire read hydrates each target under its reach.
 * An unreachable target yields nothing; a scoped one its admitted rows and fields.
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
  await populateNodes(
    nodes,
    meta,
    records,
    dialect,
    locale,
    isNull(ir.wire) ? null : ir.wire.reach,
  );
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
  reach: ReadonlyMap<string, TargetReach> | null,
): Promise<void> {
  await Promise.all(
    nodes.map((node) =>
      populateField(
        meta.fields[node.field] as FieldQueryMeta,
        node,
        records,
        dialect,
        locale,
        reach,
      ),
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
  reach: ReadonlyMap<string, TargetReach> | null,
): Promise<void> {
  if (field.kind === 'record') {
    const uuids = records.map((record) => record[node.field]).filter(isString);
    const targets = await loadTargets(field.target as string, uuids, node, dialect, locale, reach);
    for (const record of records) {
      const uuid = record[node.field];
      record[node.field] = isString(uuid) ? (targets[uuid] ?? null) : null;
    }
    return;
  }
  const uuids = records.flatMap((record) => record[node.field] as string[]);
  const targets = await loadTargets(field.target as string, uuids, node, dialect, locale, reach);
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
 * The companion joins only when a named subfield or the reach condition needs it.
 * `UUID` is always fetched for keying and child correlation.
 * When the subselect leaves `UUID` unnamed, it strips - strictly after `keyBy`.
 * The node's children recurse over the deduped targets, so a shared target hydrates once.
 * A child not named in the subselect drops, exactly as an unselected top-level populate does.
 * One row object is shared by every parent that links it, so populated targets are never cloned.
 * Under a wire reach, an unreachable target loads nothing; a scope ANDs its condition and bounds the fields.
 * A target the reach never names loads nothing either, so a wire read fails closed.
 */
async function loadTargets(
  collection: string,
  uuids: readonly string[],
  node: PopulateNode,
  dialect: Dialect,
  locale: string,
  reach: ReadonlyMap<string, TargetReach> | null,
): Promise<Partial<Record<string, QueryRecord>>> {
  const reached = isNull(reach) ? null : (reach.get(collection) ?? false);
  if (reached === false) return {};
  const meta = queryMetadata(collection);
  const named = node.select ?? reached?.select ?? null;
  const condition = reached?.condition ?? null;
  const fetched = scopeColumns(meta.fields).filter(
    (entry) => isNull(named) || named.includes(entry.name) || entry.name === 'UUID',
  );
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const from = compileFrom(
    meta,
    { fields: fetched.map((entry) => entry.name), condition },
    locale,
    dialect,
  );
  const where = isNull(condition) ? null : compileWhere(condition, meta, dialect, locale);
  const scoped = isNull(where) ? '' : ` AND (${where.sql})`;
  const projection = fetched.map((entry) => dialect.quote(entry.column)).join(', ');
  const hydrated = isNull(named)
    ? populatedSelect(null, meta.fields, node.children)
    : [...named, 'UUID'];
  const targets: QueryRecord[] = [];
  for (const batch of chunk(uniqueArray(uuids), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await useDatabase().query<Record<string, SQLValue>>(
      `SELECT ${projection} ${from.sql} WHERE ${uuid} IN (${marks})${scoped}`,
      [...from.params, ...batch, ...(where?.params ?? [])],
    );
    targets.push(...(await hydrateScope(meta.fields, rows, hydrated, dialect, locale)));
  }
  const filtered = await resolveTargets(targets, node, collection);
  const keyed = keyBy(filtered, (record) => record.UUID as string);
  const children = node.children.filter((child) => isNull(named) || named.includes(child.field));
  await populateNodes(children, meta, filtered, dialect, locale, reach);
  if (!isNull(named) && !named.includes('UUID')) {
    for (const target of filtered) delete target.UUID;
  }
  return keyed;
}

/**
 * Runs the `populate:targets` hook over a node's targets, or returns them untouched when none is registered.
 */
async function resolveTargets(
  targets: QueryRecord[],
  node: PopulateNode,
  collection: string,
): Promise<QueryRecord[]> {
  const callbacks = useHooks().get('populate:targets');
  if (isUndefined(callbacks) || callbacks.length === 0) return targets;
  return applyHook('populate:targets', targets, {
    node,
    collection: collection as CollectionName,
  });
}
