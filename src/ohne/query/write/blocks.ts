import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';

import { chunk, groupBy, isNull, isUndefined } from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';

/**
 * One block instance by identity: the type resolving its per-type table, and that table's row `UUID`.
 * The `uuid` is what a wrapper row's `_blockUUID` references - the item identity reads return.
 */
export interface BlockInstance {
  /**
   * The block type, a wrapper row's `_blockType` and `blockQueryMetadata`'s key.
   */
  type: string;

  /**
   * The instance's per-type row `UUID`.
   */
  uuid: string;
}

/**
 * Whether a field map holds a `blocks` field anywhere, nested composites included.
 * A pure metadata walk, so a delete over a blocks-free collection pays no runtime probing.
 */
export function hasBlocksField(fields: Record<string, FieldQueryMeta>): boolean {
  return Object.values(fields).some(
    (field) =>
      field.kind === 'blocks' ||
      ((field.kind === 'childOne' || field.kind === 'childMany') &&
        hasBlocksField(field.subfields as Record<string, FieldQueryMeta>)),
  );
}

/**
 * The block instances one wrapper table places under any of `parents`, chunked for the `IN` limit.
 * A locale-scoped wrapper passes the locale, so another locale's placements stay out of scope.
 */
export async function blockInstancesUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
): Promise<BlockInstance[]> {
  const instances: BlockInstance[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<BlockInstance>(
      `SELECT ${dialect.quote('_blockType')} AS ${dialect.quote('type')}, ` +
        `${dialect.quote('_blockUUID')} AS ${dialect.quote('uuid')} ` +
        `FROM ${dialect.quote(table)} WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    instances.push(...rows);
  }
  return instances;
}

/**
 * Every block instance a field map's rows under `parents` place, one ownership level deep.
 *
 * A `blocks` field contributes its wrapper rows' instances directly.
 * A composite walks its child rows by `_parentUUID`: a nested blocks field wraps off the child table.
 * The walk is unscoped on purpose: a doomed parent takes every locale's placements with it.
 */
export async function ownedBlockInstances(
  tx: Transaction,
  dialect: Dialect,
  fields: Record<string, FieldQueryMeta>,
  parents: readonly string[],
): Promise<BlockInstance[]> {
  if (parents.length === 0) return [];
  const found: BlockInstance[] = [];
  for (const field of Object.values(fields)) {
    if (field.kind === 'blocks') {
      found.push(...(await blockInstancesUnder(tx, dialect, field.table as string, parents, null)));
      continue;
    }
    if (field.kind !== 'childOne' && field.kind !== 'childMany') continue;
    const subfields = field.subfields as Record<string, FieldQueryMeta>;
    if (!hasBlocksField(subfields)) continue;
    const rows = await childRowsUnder(tx, dialect, field.table as string, parents, null);
    found.push(...(await ownedBlockInstances(tx, dialect, subfields, rows)));
  }
  return found;
}

/**
 * The full doomed instance set under `doomed`, walked to a fixed point.
 *
 * Each level's instances contribute the wrapper rows their own subtrees place, nested composites included.
 * The walk repeats until no new instance appears.
 * Ownership is a tree, so the walk terminates.
 * The seen-set guards a corrupted cyclic reference from hanging it.
 * Instances are exclusively owned by construction, so no reference probe precedes the delete.
 * A create never accepts an instance id; an update correlates only the parent's own.
 */
export async function collectBlockSubtree(
  tx: Transaction,
  dialect: Dialect,
  doomed: readonly BlockInstance[],
): Promise<BlockInstance[]> {
  const seen = new Set<string>();
  const all: BlockInstance[] = [];
  let frontier = doomed.filter((instance) => claim(seen, instance));
  while (frontier.length > 0) {
    all.push(...frontier);
    const next: BlockInstance[] = [];
    const byType = groupBy(frontier, (instance) => instance.type);
    for (const [type, group] of Object.entries(byType)) {
      if (isUndefined(group)) continue;
      const found = await ownedBlockInstances(
        tx,
        dialect,
        blockQueryMetadata(type).fields,
        group.map((instance) => instance.uuid),
      );
      next.push(...found.filter((instance) => claim(seen, instance)));
    }
    frontier = next;
  }
  return all;
}

/**
 * Marks one instance seen, refusing a repeat, so the subtree walk visits each identity once.
 */
function claim(seen: Set<string>, instance: BlockInstance): boolean {
  const key = `${instance.type}:${instance.uuid}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * Deletes the named instances' per-type rows, chunked per type table.
 *
 * `_blockUUID` carries no foreign key - the reference is polymorphic.
 * This is the cleanup the write layer owes wherever it dooms wrapper rows.
 * The instances are exclusively the caller's.
 * Each instance's junctions, child tables, and nested wrapper rows follow through `ON DELETE CASCADE`.
 */
export async function deleteBlockInstances(
  tx: Transaction,
  dialect: Dialect,
  instances: readonly BlockInstance[],
): Promise<void> {
  const byType = groupBy(instances, (instance) => instance.type);
  for (const [type, group] of Object.entries(byType)) {
    if (isUndefined(group)) continue;
    const table = dialect.quote(blockQueryMetadata(type).table);
    for (const batch of chunk(
      group.map((instance) => instance.uuid),
      900,
    )) {
      const marks = batch.map(() => '?').join(', ');
      await tx.run(`DELETE FROM ${table} WHERE ${dialect.quote('UUID')} IN (${marks})`, [...batch]);
    }
  }
}

/**
 * The `UUID`s of one composite table's rows under any of `parents`, for the ownership walk.
 * A `null` locale reads every row: the walk serves paths that doom the parent whole.
 * A locale narrows to its rows alone, for a translation delete's first hop into a scoped composite.
 */
export async function childRowsUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
): Promise<string[]> {
  const uuids: string[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ UUID: string }>(
      `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    uuids.push(...rows.map((row) => row.UUID));
  }
  return uuids;
}
