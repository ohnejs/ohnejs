import type { CollectionQueryMeta, QueryScope } from 'ohnejs';
import type { SearchParamValue } from 'ohnejs/utils';

import { parseWireQuery, queryMetadata, resolveGuards, scopedMetadata } from 'ohnejs';
import { isString, keywordsCondition, renderLabel, searchByKeywords } from 'ohnejs/utils';

import type { User } from '../auth/types.ts';

import { HTTPError } from '../../ohne/http/http-error.ts';
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
 * Only the first ten tokens count.
 * A refused read, or a scope hiding the `UUID` or every label field, skips the collection.
 * Each collection answers its most recently created matches.
 * Records whose label holds every token lead, the earliest hits first; the rest follow in registry order.
 */
export async function searchRecords(user: User, q: string, limit: number): Promise<SearchResult[]> {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  if (tokens.length === 0) return [];
  const guards = resolveGuards();
  const results: SearchResult[] = [];
  for (const collection of describeCollections(user)) {
    if (collection.singleton || collection.operations.read?.allowed !== true) continue;
    const reach = await reachOf(collection.name);
    if (reach === false) continue;
    const meta = scopedMetadata(queryMetadata(collection.name), reach);
    const labels = collection.labelFields.filter((name) => meta.fields[name]?.readable !== false);
    const fields = textFields(meta).slice(0, Math.floor(guards.maxConditions / tokens.length));
    if (meta.fields.UUID?.readable === false || labels.length === 0 || fields.length === 0)
      continue;
    const parsed = await parseWireQuery(
      {
        select: ['UUID', ...labels],
        where: keywordsCondition(tokens, fields) as SearchParamValue,
        order: ['-UUID'],
        limit,
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
 * The readable plain text columns of a scoped collection, its `UUID` aside.
 */
function textFields(meta: CollectionQueryMeta): string[] {
  return Object.entries(meta.fields)
    .filter(
      ([, field]) =>
        field.kind === 'column' &&
        field.logicalType === 'text' &&
        field.readable !== false &&
        field.id !== true,
    )
    .map(([name]) => name);
}
