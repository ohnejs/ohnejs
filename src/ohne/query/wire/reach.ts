import type { ConditionNode, SearchParamValue } from '../../../utils/index.ts';
import type { TargetReach } from '../ir.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';
import type { QueryScope } from './apply.ts';
import type { QueryGuards } from './guards.ts';
import type { ParsedQuery } from './parse.ts';

import {
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  parseCondition,
  toArray,
} from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { splitBlockHas } from '../block-has.ts';
import { queryMetadata } from '../metadata.ts';
import { blockScope, targetScope, validateCondition } from '../validate-condition.ts';
import { scopedMetadata } from './apply.ts';
import { parseQueryParams } from './parse.ts';

/**
 * Resolves a caller's read reach into one collection.
 * `false` reaches nothing; a scope is what the caller's reads of it compose under.
 * The shipped endpoints answer from the collection's read exposure, its guard, and its `access` resolver.
 */
export type ReachResolver = (collection: string) => Promise<QueryScope | false>;

/**
 * Parses a wire query and resolves the read reach of every collection it populates or probes.
 *
 * The raw `populate` and `where` are walked for the collections they cross into before anything parses.
 * The walk is tolerant: a malformed entry is left for the parse to refuse, so no target shapes an error.
 * `resolve` answers each crossed collection, and the query then parses against metadata hiding what
 * each reach withholds.
 * A target field outside a reach is therefore refused in a subselect or a `has` leaf as an unknown field.
 * The reach rides the parsed query for `applyQuery` to install, and every read compiles under it.
 * A reach scope's `where` and `select` carry; its `limit` and `locale` do not apply to a crossed read.
 * A misconfigured reach scope throws, as the gate's own does.
 *
 * @example
 * ```ts
 * const parsed = await parseWireQuery(useSearchParams(), meta, resolveGuards(), readReach)
 * const rows = await applyQuery(queryUntyped('Posts'), parsed, scope).findMany()
 * ```
 */
export async function parseWireQuery(
  params: Record<string, SearchParamValue>,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
  resolve: ReachResolver,
): Promise<ParsedQuery> {
  const crossed = new Set<string>();
  if (!isUndefined(params.populate)) crossPopulate(toArray(params.populate), meta, crossed);
  if (!isUndefined(params.where)) {
    const parsed = parseCondition(params.where);
    if (parsed.ok) crossCondition(parsed.node, meta, crossed);
  }
  if (crossed.size === 0) return parseQueryParams(params, meta, guards);
  const reach = new Map<string, TargetReach>();
  for (const collection of crossed) reach.set(collection, await targetReach(collection, resolve));
  const metaOf = (collection: string): CollectionQueryMeta => reachedMetadata(collection, reach);
  return Object.freeze({ ...parseQueryParams(params, meta, guards, metaOf), reach });
}

/**
 * Collects the collections a raw populate level and its descendants hydrate, skipping what it cannot read.
 */
function crossPopulate(
  entries: readonly unknown[],
  meta: CollectionQueryMeta,
  found: Set<string>,
): void {
  for (const entry of entries) {
    if (isString(entry)) {
      const target = relationTarget(meta, entry);
      if (!isNull(target)) found.add(target);
      continue;
    }
    if (!isPlainObject(entry)) continue;
    for (const [field, spec] of Object.entries(entry)) {
      const target = relationTarget(meta, field);
      if (isNull(target)) continue;
      found.add(target);
      if (isPlainObject(spec) && !isUndefined(spec.populate)) {
        crossPopulate(toArray(spec.populate), queryMetadata(target), found);
      }
    }
  }
}

/**
 * Collects the collections a condition's conditioned `has` probes reach, at every depth.
 * A bare `has` or `empty` never crosses: it tests the parent's own link, not the target's rows.
 */
function crossCondition(node: ConditionNode, meta: CollectionQueryMeta, found: Set<string>): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) crossCondition(child, meta, found);
    return;
  }
  if (node.kind !== 'has' || isNull(node.condition)) return;
  const name = node.path[0];
  const field = meta.fields[name];
  if (isUndefined(field)) return;
  if (field.kind === 'blocks') {
    const split = splitBlockHas(node.condition);
    if (split.ok && !isNull(split.rest)) {
      crossCondition(split.rest, blockScope(split.block, name, meta), found);
    }
    return;
  }
  if (field.kind === 'record' || field.kind === 'records') found.add(field.target as string);
  crossCondition(node.condition, targetScope(field, name, meta), found);
}

/**
 * The collection a relation field targets, or `null` for an unknown or non-relation field.
 */
function relationTarget(meta: CollectionQueryMeta, field: string): string | null {
  const entry = meta.fields[field];
  if (isUndefined(entry) || (entry.kind !== 'record' && entry.kind !== 'records')) return null;
  return entry.target as string;
}

/**
 * One collection's reach, its scope `where` gated into a condition node and its `select` carried as is.
 */
async function targetReach(collection: string, resolve: ReachResolver): Promise<TargetReach> {
  const verdict = await resolve(collection);
  if (verdict === false) return false;
  if (!isUndefined(verdict.select) && verdict.select.length === 0) {
    throw ohneError(
      `An \`access\` scope on \`${collection}\` resolved an empty \`select\`; return \`false\` to refuse the read instead`,
    );
  }
  return {
    condition: isUndefined(verdict.where) ? null : reachCondition(verdict.where, collection),
    select: verdict.select ?? null,
  };
}

/**
 * Parses and gates a reach scope's `where` against its collection; a malformed one is a misconfiguration.
 */
function reachCondition(where: ConditionInput, collection: string): ConditionNode {
  const meta = queryMetadata(collection);
  const parsed = parseCondition(where);
  if (!parsed.ok) {
    throw ohneError({
      title: `Invalid \`access\` scope on \`${collection}\``,
      body: [`The scope's \`where\` is malformed (${parsed.error.code}).`],
    });
  }
  validateCondition(parsed.node, meta);
  return parsed.node;
}

/**
 * The metadata a crossed collection parses against: its reach's `select` hides the rest, `false` hides all.
 */
function reachedMetadata(
  collection: string,
  reach: ReadonlyMap<string, TargetReach>,
): CollectionQueryMeta {
  const meta = queryMetadata(collection);
  const entry = reach.get(collection);
  if (isUndefined(entry)) return meta;
  if (entry === false) return scopedMetadata(meta, { select: [] });
  return isNull(entry.select) ? meta : scopedMetadata(meta, { select: [...entry.select] });
}
