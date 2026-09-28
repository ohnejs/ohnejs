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
import { allowedOperators } from '../operators.ts';
import { blockScope, targetScope, validateCondition } from '../validate-condition.ts';
import { conditionBinds, parseQueryParams } from './parse.ts';
import { conditionLocaleSensitive, withheldMetadata } from './withheld-metadata.ts';

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
 * `resolve` answers each crossed collection.
 * The query then parses against metadata that hides what each reach withholds.
 * Every conditioned `has` repeats its target's reach condition, so each counts toward `maxBoundParams`.
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
  const probes: string[] = [];
  if (!isUndefined(params.populate)) crossPopulate(toArray(params.populate), meta, crossed);
  if (!isUndefined(params.where)) {
    const parsed = parseCondition(params.where);
    if (parsed.ok) crossCondition(parsed.node, meta, probes);
  }
  for (const target of probes) crossed.add(target);
  if (crossed.size === 0) return parseQueryParams(params, meta, guards);
  const reach = new Map<string, TargetReach>();
  for (const collection of crossed) reach.set(collection, await targetReach(collection, resolve));
  const metaOf = (collection: string): CollectionQueryMeta => reachedMetadata(collection, reach);
  let reserved = 0;
  for (const target of probes) reserved += reachBinds(reach.get(target) as TargetReach);
  return Object.freeze({ ...parseQueryParams(params, meta, guards, metaOf, reserved), reach });
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
 * Collects the target of every conditioned relation `has` a condition makes, once per probe, at every depth.
 * A bare `has` or `empty` never crosses: it tests the parent's own link, not the target's rows.
 */
function crossCondition(node: ConditionNode, meta: CollectionQueryMeta, probes: string[]): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) crossCondition(child, meta, probes);
    return;
  }
  if (node.kind !== 'has' || isNull(node.condition)) return;
  const name = node.path[0];
  const field = meta.fields[name];
  if (isUndefined(field) || !allowedOperators(field).has('has')) return;
  if (field.kind === 'blocks') {
    const split = splitBlockHas(node.condition);
    if (!split.ok || isNull(split.rest)) return;
    if (!(field.allow as readonly string[]).includes(split.block)) return;
    crossCondition(split.rest, blockScope(split.block, name, meta), probes);
    return;
  }
  if (field.kind === 'record' || field.kind === 'records') probes.push(field.target as string);
  crossCondition(node.condition, targetScope(field, name, meta), probes);
}

/**
 * The bound parameters a target's reach condition adds to each conditioned probe into it.
 */
function reachBinds(reach: TargetReach): number {
  return reach === false || isNull(reach.condition) ? 0 : conditionBinds(reach.condition);
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
 * A locale-sensitive reach condition seals the target's `_translations` against a probe's filter.
 */
function reachedMetadata(
  collection: string,
  reach: ReadonlyMap<string, TargetReach>,
): CollectionQueryMeta {
  const meta = queryMetadata(collection);
  const entry = reach.get(collection);
  if (isUndefined(entry)) return meta;
  if (entry === false) return withheldMetadata(meta, [], false);
  const sealed =
    meta.translatable === true &&
    !isNull(entry.condition) &&
    conditionLocaleSensitive(entry.condition, meta);
  return withheldMetadata(meta, entry.select, sealed);
}
