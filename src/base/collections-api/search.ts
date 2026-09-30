import type { CollectionQueryMeta, FieldQueryMeta, QueryScope } from 'ohnejs';
import type { ConditionObject, SearchParamValue } from 'ohnejs/utils';

import { parseWireQuery, queryMetadata, resolveGuards, scopedMetadata } from 'ohnejs';
import { isEmpty, isString, isUndefined, renderLabel, searchByKeywords } from 'ohnejs/utils';

import type { User } from '../auth/types.ts';

import { HTTPError } from '../../ohne/http/http-error.ts';
import { blockScope, targetScope } from '../../ohne/query/validate-condition.ts';
import { describeCollections } from './describe.ts';
import { listRecords, readReach } from './gate.ts';

/**
 * One record a search found.
 */
export interface SearchResult {
  /**
   * The registered collection name, in PascalCase.
   */
  collection: string;

  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The record's label, rendered from the label fields the caller may read; `''` when none carries text.
   */
  label: string;
}

/**
 * How a search windows its answer.
 */
export interface SearchWindow {
  /**
   * The records to answer per collection.
   */
  limit: number;

  /**
   * The one collection to search, by its registered name, to page through it.
   */
  collection?: string;

  /**
   * The matches to skip in each collection, newest first.
   *
   * @default
   * 0
   */
  offset?: number;
}

/**
 * The records a search answers per collection when the request names no `limit`.
 */
export const SEARCH_LIMIT = 5;

const MAX_TOKENS = 10;

/**
 * Finds the records of every collection `user` may query whose text holds each whitespace-separated token.
 *
 * A collection takes part when its read is served and allowed, it names a label, and it is no singleton.
 * Each runs one wire query under `readReach`, so its read middleware and `access` apply as a list read's do.
 * A token matches case-insensitively in any readable text field inside the read scope.
 * That reaches into child fields and every block type a blocks field allows, never a relation's target.
 * Only the first ten tokens count, and together they stay within `maxConditions` and `maxHasDepth`.
 * Plain text fields fill that budget first, then the nested ones in field order; what does not fit drops.
 * A refused read, or a scope hiding the `UUID` or every label field, skips the collection.
 * Each collection answers its most recently created matches, from `offset` on.
 * Records whose label holds every token lead, the earliest hits first; the rest follow in registry order.
 * With `collection` only that one is searched, newest first, so its pages follow each other.
 */
export async function searchRecords(
  user: User,
  q: string,
  { limit, collection: only, offset = 0 }: SearchWindow,
): Promise<SearchResult[]> {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  if (tokens.length === 0) return [];
  const guards = resolveGuards();
  const results: SearchResult[] = [];
  for (const collection of describeCollections(user)) {
    if (!isUndefined(only) && collection.name !== only) continue;
    if (collection.singleton || collection.operations.read?.allowed !== true) continue;
    const reach = await reachOf(collection.name);
    if (reach === false) continue;
    const meta = scopedMetadata(queryMetadata(collection.name), reach);
    const labels = collection.labelFields.filter((name) => meta.fields[name]?.readable !== false);
    const budget = Math.floor(guards.maxConditions / tokens.length);
    const match = (token: string): ConditionObject[] =>
      textBranches(meta, token, budget, guards.maxHasDepth).branches;
    if (meta.fields.UUID?.readable === false || labels.length === 0 || isEmpty(match(''))) continue;
    const parsed = await parseWireQuery(
      {
        select: ['UUID', ...labels],
        where: { and: tokens.map((token) => ({ or: match(token) })) } as SearchParamValue,
        order: ['-UUID'],
        limit,
        offset,
      },
      meta,
      guards,
      readReach,
    );
    const rows = (await listRecords(collection.name, parsed, reach)) as Record<string, unknown>[];
    for (const row of rows) {
      if (!isString(row.UUID)) continue;
      const label = renderLabel(row, labels, collection.labelTemplate);
      results.push({ collection: collection.name, UUID: row.UUID, label });
    }
  }
  if (!isUndefined(only)) return results;
  const named = searchByKeywords(results, tokens, 'label');
  const lead = new Set(named);
  return [...named, ...results.filter((result) => !lead.has(result))];
}

/**
 * The caller's read reach, where an `HTTPError` the `access` resolver throws reaches nothing.
 */
async function reachOf(collection: string): Promise<QueryScope | false> {
  try {
    return await readReach(collection);
  } catch (error) {
    if (error instanceof HTTPError) return false;
    throw error;
  }
}

/**
 * The `or` branches matching `token` in a scope's own text, and the conditions they count.
 * Plain text columns come first, then each child field and each allowed block type, one `has` deeper.
 * A branch that would overrun `budget` drops, and no `has` opens past `depth` levels.
 * The shape depends only on the scope, so every token gets the same branches at the same cost.
 */
function textBranches(
  scope: CollectionQueryMeta,
  token: string,
  budget: number,
  depth: number,
): { branches: ConditionObject[]; cost: number } {
  const readable = Object.entries(scope.fields).filter(
    ([, field]) => field.readable !== false && field.id !== true,
  );
  const branches: ConditionObject[] = [];
  let cost = 0;
  for (const [name, field] of readable) {
    if (field.kind !== 'column' || field.logicalType !== 'text' || cost >= budget) continue;
    branches.push({ [name]: { contains: token } });
    cost += 1;
  }
  if (depth === 0) return { branches, cost };
  for (const [name, field] of readable) {
    for (const [inner, head] of nestedScopes(scope, name, field)) {
      const overhead = 1 + Object.keys(head).length;
      if (cost + overhead >= budget) continue;
      const found = textBranches(inner, token, budget - cost - overhead, depth - 1);
      if (isEmpty(found.branches)) continue;
      branches.push({ [name]: { has: { ...head, or: found.branches } } });
      cost += overhead + found.cost;
    }
  }
  return { branches, cost };
}

/**
 * The scopes a `has` on the field opens, each with the leaves its condition must lead with.
 * A child field opens its subfields; a blocks field opens each allowed type behind its `block` equality.
 */
function nestedScopes(
  scope: CollectionQueryMeta,
  name: string,
  field: FieldQueryMeta,
): [CollectionQueryMeta, ConditionObject][] {
  if (field.kind === 'childOne' || field.kind === 'childMany')
    return [[targetScope(field, name, scope), {}]];
  if (field.kind !== 'blocks') return [];
  return (field.allow ?? []).map((block) => [blockScope(block, name, scope), { block }]);
}
