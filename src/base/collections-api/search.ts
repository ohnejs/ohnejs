import type { CollectionQueryMeta, FieldQueryMeta, FieldSearchContext, QueryScope } from 'ohnejs';
import type { ConditionObject, SearchParamValue } from 'ohnejs/utils';

import {
  parseWireQuery,
  queryMetadata,
  resolveGuards,
  scopedMetadata,
  searchHook,
  useCollections,
  useFields,
  usePrinter,
} from 'ohnejs';
import {
  foldCase,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  isUUID,
  parseCondition,
  renderLabel,
  searchByKeywords,
  searchTokens,
  uniqueArray,
  walkCondition,
} from 'ohnejs/utils';

import type { User } from '../auth/types.ts';
import type { DashboardCollection } from './describe.ts';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { HTTPError } from '../../ohne/http/http-error.ts';
import { resolveMessage } from '../../ohne/http/translate.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { allowedOperators } from '../../ohne/query/operators.ts';
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

  /**
   * Stops the search once aborted: no further collection is read, and the records found so far answer.
   */
  signal?: AbortSignal;
}

/**
 * A collection a search may read, with the reach and the metadata its read runs under.
 */
interface Searchable {
  collection: DashboardCollection;
  reach: QueryScope;
  meta: CollectionQueryMeta;
  labels: string[];
}

/**
 * A found record, beside its raw label values folded for the re-rank.
 */
interface Hit {
  result: SearchResult;
  text: string;
}

/**
 * The `or` branches a token matches in one scope, and the conditions they count.
 */
interface Branches {
  branches: ConditionObject[];
  cost: number;
}

/**
 * The records a search answers per collection when the request names no `limit`.
 */
export const SEARCH_LIMIT = 5;

/**
 * The most records a search answers per collection; a larger `limit` lowers to it.
 */
export const SEARCH_MAX_LIMIT = 50;

/**
 * The deepest `offset` a search pages to; past it, nothing more answers.
 */
export const SEARCH_MAX_OFFSET = 1000;

/**
 * Finds the records of every collection `user` may query that hold each of the query's `searchTokens`.
 *
 * A word matches a record's own fields: its label fields first, then every other field search reads.
 * Each field type's search hook decides how; a text field without one matches by substring.
 * The words reach into child fields and the block types a blocks field allows, never a relation's target.
 * A whole `UUID` matches the record with that `UUID`, or the record owning an item with it.
 * A collection takes part when its read is allowed and reaches, and its `UUID` is readable.
 * Words also need `dashboard.search` on, a label field the caller may read, and no singleton.
 * Each collection runs one wire query under its read reach, so its middleware and `access` apply.
 * A translatable collection reads in the user's content language, when it is one of the content locales.
 * Together the tokens stay within `maxConditions` and `maxHasDepth`; what does not fit drops.
 * A read that refuses with an `HTTPError` skips that collection alone.
 * Each collection answers its most recently created matches, from `offset` on.
 * Records whose raw label values hold every word lead, closest match first; the rest keep registry order.
 * With `collection` only that one is searched, newest first, so its pages follow each other.
 */
export async function searchRecords(
  user: User,
  q: string,
  { limit, collection: only, offset = 0, signal }: SearchWindow,
): Promise<SearchResult[]> {
  const tokens = searchTokens(q).map((token) => (isUUID(token) ? token.toLowerCase() : token));
  if (isEmpty(tokens)) return [];
  const hits: Hit[] = [];
  for (const collection of describeCollections(user)) {
    if (signal?.aborted === true) break;
    if (!isUndefined(only) && collection.name !== only) continue;
    const found = await isolated(collection.name, async () => {
      const target = await searchable(collection, tokens);
      if (isNull(target) || signal?.aborted === true) return [];
      return readDirect(target, tokens, user, limit, offset);
    });
    hits.push(...found);
  }
  const words = tokens.filter((token) => !isUUID(token)).map((token) => foldCase(token));
  if (!isUndefined(only) || isEmpty(words)) return hits.map((hit) => hit.result);
  return uniqueArray([...searchByKeywords(hits, words, 'text'), ...hits]).map((hit) => hit.result);
}

/**
 * The collection's search target, or `null` when the tokens may not search it.
 * The read must be allowed and reach, and the scope must leave the `UUID` readable.
 * A word also needs `dashboard.search` on, no singleton, and a label field the scope leaves readable.
 */
async function searchable(
  collection: DashboardCollection,
  tokens: readonly string[],
): Promise<Searchable | null> {
  const words = tokens.some((token) => !isUUID(token));
  if (collection.operations.read?.allowed !== true) return null;
  const quiet = useCollections().get(collection.name)?.collection.dashboard?.search === false;
  if (words && (collection.singleton || quiet)) return null;
  const reach = await reachOf(collection.name);
  if (reach === false) return null;
  const meta = scopedMetadata(queryMetadata(collection.name), reach);
  const labels = collection.labelFields.filter((name) => meta.fields[name]?.readable !== false);
  if (meta.fields.UUID?.readable === false || (words && isEmpty(labels))) return null;
  return { collection, reach, meta, labels };
}

/**
 * Reads the records of one target holding every token in their own fields.
 * A token with no branch in the target matches none of its records, so the read never runs.
 */
async function readDirect(
  { collection, reach, meta, labels }: Searchable,
  tokens: readonly string[],
  user: User,
  limit: number,
  offset: number,
): Promise<Hit[]> {
  const guards = resolveGuards();
  const budget = Math.floor(guards.maxConditions / tokens.length);
  const matches = tokens.map((token) => own(meta, token, budget, guards.maxHasDepth, labels));
  if (matches.some((match) => isEmpty(match.branches))) return [];
  const locale = contentLocale(user, meta);
  const parsed = await parseWireQuery(
    {
      select: ['UUID', ...labels],
      where: { and: matches.map((match) => ({ or: match.branches })) } as SearchParamValue,
      order: ['-UUID'],
      limit,
      offset,
      ...(isUndefined(locale) ? {} : { locale }),
    },
    meta,
    guards,
    reachOf,
  );
  const rows = (await listRecords(collection.name, parsed, reach)) as Record<string, unknown>[];
  return rows
    .filter((row) => isString(row.UUID))
    .map((row) => ({
      result: {
        collection: collection.name,
        UUID: row.UUID as string,
        label: isEmpty(labels) ? '' : renderLabel(row, labels, collection.labelTemplate),
      },
      text: foldCase(renderLabel(row, labels)),
    }));
}

/**
 * The `or` branches matching `token` in a scope's own fields, and the conditions they count.
 * A `UUID` token matches the scope's own `UUID`.
 * A word matches `labels` first, then every other column search reads, through its type's hook.
 * Each child field and allowed block type follows one `has` deeper.
 * A word never enters a composite whose `search` is off; a `UUID` enters every readable one.
 * A branch that would overrun `budget` drops, and a `has` opens only while `depth` has a level left.
 */
function own(
  scope: CollectionQueryMeta,
  token: string,
  budget: number,
  depth: number,
  labels: readonly string[] = [],
): Branches {
  const identity = isUUID(token);
  const readable = Object.entries(scope.fields).filter(([, field]) => field.readable !== false);
  const found: Branches = { branches: [], cost: 0 };
  const add = (branch: ConditionObject, cost: number): void => {
    if (found.cost + cost > budget) return;
    found.branches.push(branch);
    found.cost += cost;
  };
  if (identity) add({ UUID: { equalsTo: token } }, 1);
  else {
    const columns = readable.filter(
      ([, field]) => field.kind === 'column' && field.search === true && field.id !== true,
    );
    const ordered = [
      ...columns.filter(([name]) => labels.includes(name)),
      ...columns.filter(([name]) => !labels.includes(name)),
    ];
    for (const [name, field] of ordered) {
      const match = columnMatch(scope, name, field, token);
      if (!isNull(match)) add(match.branch, match.cost);
    }
  }
  if (depth === 0) return found;
  for (const [name, field] of readable) {
    if (!identity && field.search !== true) continue;
    for (const [inner, head] of nestedScopes(scope, name, field)) {
      const overhead = 1 + Object.keys(head).length;
      if (found.cost + overhead >= budget) continue;
      const nested = own(inner, token, budget - found.cost - overhead, depth - 1);
      if (isEmpty(nested.branches)) continue;
      add({ [name]: { has: { ...head, or: nested.branches } } }, overhead + nested.cost);
    }
  }
  return found;
}

/**
 * The one branch a word matches in a column, and its leaf count, or `null` when it cannot match.
 * The type's hook decides; without one, a `text` column matches by `contains`.
 * A hook answering an operator its field refuses is a programming error, so it throws.
 */
function columnMatch(
  scope: CollectionQueryMeta,
  name: string,
  field: FieldQueryMeta,
  token: string,
): { branch: ConditionObject; cost: number } | null {
  const hook = isUndefined(field.fieldType) ? undefined : searchHook(field.fieldType);
  if (isUndefined(hook)) {
    return field.logicalType === 'text'
      ? { branch: { [name]: { contains: token } }, cost: 1 }
      : null;
  }
  const options = field.options as FieldSearchContext['options'];
  const value = hook({ name, options, token, resolveMessage });
  if (isNull(value)) return null;
  const branch = { [name]: value };
  const parsed = parseCondition(branch);
  const type = typeName(field);
  if (!parsed.ok) {
    throw ohneError({
      title: `Search hook of \`${type}\` answers a malformed condition for \`${scope.collection}.${name}\``,
      body: [
        `For \`${scope.collection}.${name}\` it answered a condition failing with \`${parsed.error.code}\`.`,
        'Return the value side of a condition, like `{ startsWith: token }`, or `null`.',
      ],
    });
  }
  const allowed = allowedOperators(field);
  let cost = 0;
  walkCondition(parsed.node, (node) => {
    if (node.kind === 'and' || node.kind === 'or') return;
    cost += 1;
    const operator = node.kind === 'compare' ? node.op : node.kind;
    if (allowed.has(operator)) return;
    throw ohneError({
      title: `Search hook of \`${type}\` answers \`${operator}\` for \`${scope.collection}.${name}\``,
      body: [
        `The field \`${scope.collection}.${name}\` does not admit \`${operator}\`.`,
        `Return only operators it admits: ${[...allowed].map((op) => `\`${op}\``).join(', ')}.`,
      ],
    });
  });
  return { branch, cost };
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

/**
 * The content locale a translatable collection reads in: the user's content language when configured.
 * `undefined` reads the default locale, and so does every collection without translatable fields.
 */
function contentLocale(user: User, meta: CollectionQueryMeta): string | undefined {
  const language = user.contentLanguage;
  if (meta.translatable !== true || isNull(language)) return undefined;
  return queryLocales().locales.includes(language) ? language : undefined;
}

/**
 * The caller's read reach, where an `HTTPError` the read's middleware or `access` throws reaches nothing.
 * `readReach` memoizes per request, so each collection resolves once however often a search asks.
 */
async function reachOf(collection: string): Promise<QueryScope | false> {
  try {
    return await readReach(collection);
  } catch (error) {
    if (!(error instanceof HTTPError)) throw error;
    skipped(collection, error);
    return false;
  }
}

/**
 * Runs one collection's read, skipping it with a `DEBUG` line when it refuses with an `HTTPError`.
 * Any other throw propagates, so a misconfiguration stays a `500`.
 */
async function isolated(collection: string, read: () => Promise<Hit[]>): Promise<Hit[]> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof HTTPError)) throw error;
    skipped(collection, error);
    return [];
  }
}

/**
 * Prints the `DEBUG` line for a collection a search skips over an `HTTPError`.
 */
function skipped(collection: string, error: HTTPError): void {
  usePrinter().debug(`Search skipped \`${collection}\`: its read answered \`${error.status}\``);
}

/**
 * The registered name of a field's type, for an error to name it.
 */
function typeName(field: FieldQueryMeta): string {
  const types = Object.values(useFields().all());
  return types.find((type) => type.fieldType === field.fieldType)?.name ?? 'unknown';
}
