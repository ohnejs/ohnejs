import type {
  CollectionQueryMeta,
  FieldQueryMeta,
  FieldSearchContext,
  QueryGuards,
  QueryScope,
} from 'ohnejs';
import type { ConditionNode, ConditionObject, SearchParamValue } from 'ohnejs/utils';

import {
  conditionBinds,
  parseWireQuery,
  queryMetadata,
  readBinds,
  resolveGuards,
  scopedMetadata,
  searchHook,
  useCollections,
  useFields,
  usePrinter,
} from 'ohnejs';
import {
  chunk,
  first,
  foldCase,
  getOrSet,
  groupBy,
  intersection,
  isEmpty,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  isUUID,
  parseCondition,
  renderLabel,
  searchByKeywords,
  searchTokens,
  serializeCondition,
  toArray,
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

  /**
   * The linked records a related result was found through.
   * A direct result matched on its own fields and carries none.
   */
  via?: SearchVia;
}

/**
 * The linked records of one collection a related result was found through.
 */
export interface SearchVia {
  /**
   * The registered name of the collection the linked records belong to.
   */
  collection: string;

  /**
   * Each linked record that matched a word or a pasted `UUID`, in the order of the paths reaching it.
   */
  targets: SearchTarget[];
}

/**
 * One linked record a related result was found through.
 */
export interface SearchTarget {
  /**
   * The linked record's `UUID`.
   */
  UUID: string;

  /**
   * The linked record's label, rendered from the label fields the caller may read.
   */
  label: string;

  /**
   * The relation field's dot path from the result's root, naming the block type at each blocks level.
   */
  path: string;
}

/**
 * What a search answers.
 */
export interface SearchAnswer {
  /**
   * The direct results, then the related ones.
   */
  results: SearchResult[];

  /**
   * Marks an answer that left out the related groups past `RELATED_PASSES`.
   */
  truncated?: true;
}

/**
 * How a search windows its answer.
 */
export interface SearchWindow {
  /**
   * The records to answer per collection, and per related group.
   */
  limit: number;

  /**
   * The one collection to search, by its registered name, to page through it.
   */
  collection?: string;

  /**
   * The collection whose links find `collection`'s related records, to page through that one group.
   * Without `collection` it finds nothing.
   */
  via?: string;

  /**
   * The matches to skip in each collection, newest first.
   *
   * @default
   * 0
   */
  offset?: number;

  /**
   * The collections to leave out, by their registered names.
   * They are never searched, followed, or counted toward `RELATED_PASSES`.
   * So they take no related group's place.
   */
  exclude?: readonly string[];

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
 * A collection related records are found through, with the label fields words match in it.
 */
interface Linkable extends Searchable {
  matched: string[];
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
 * One composite level a link path descends through, with the leaves its `has` leads with.
 */
interface Step {
  name: string;
  head: ConditionObject;
}

/**
 * A relation field a record links through, reached from the root through `steps`.
 * `words` is off once the field or a composite above it has `search` off.
 */
interface LinkPath {
  path: string;
  steps: Step[];
  name: string;
  field: FieldQueryMeta;
  words: boolean;
}

/**
 * One related read: the records of `from` linking into `to`, and the pasted `UUID`s routed to `to`.
 */
interface Pair {
  from: Searchable;
  to: Linkable;
  paths: LinkPath[];
  identities: string[];
}

/**
 * The link branches one token takes in a related read, the conditions they count, and the paths used.
 * `crossings` counts the `has` into the target, each repeating its reach condition.
 */
interface Links extends Branches {
  paths: LinkPath[];
  crossings: number;
}

/**
 * The state one search shares across its reads.
 */
interface Search {
  user: User;
  tokens: string[];
  words: string[];
  identities: string[];
  limit: number;
  offset: number;
  signal?: AbortSignal;
  guards: QueryGuards;
  collections: DashboardCollection[];
  targets: Map<string, Promise<Linkable | null>>;
  probes: Map<string, Promise<boolean>>;
  scopes: Map<CollectionQueryMeta['fields'], Map<string, Branches>>;
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
 * The most related groups a word search reads; a pasted `UUID`'s usages are never capped.
 */
export const RELATED_PASSES = 8;

/**
 * Finds the records of every collection `user` may query that hold each of the query's `searchTokens`.
 *
 * A word matches a record's own fields: its label fields first, then every other field search reads.
 * Each field type's search hook decides how; a text field without one matches by substring.
 * The words reach into child fields and the block types a blocks field allows.
 * A whole `UUID` matches the record with that `UUID`, or the record owning an item with it.
 * A collection takes part when its read is allowed and reaches, and its `UUID` is readable.
 * Words also need `dashboard.search` on, a label field the caller may read, and no singleton.
 * Each collection runs one wire query under its read reach, so its middleware and `access` apply.
 * A translatable collection reads in the user's content language, when it is one of the content locales.
 * Together the tokens stay within `maxConditions` and `maxHasDepth`; what does not fit drops.
 * A read that refuses with an `HTTPError` skips that read alone.
 * Each collection answers its most recently created matches, from `offset` on.
 * Records whose raw label values hold every word lead, closest match first; the rest keep registry order.
 * With `collection` only that one is searched, newest first, so its pages follow each other.
 *
 * Related results follow, each carrying `via`: records that are no direct hit, linking to a matching record.
 * Each token matches their own fields or the label of a record a relation field links to, at any depth.
 * A pasted `UUID` lists the records linking to it, in its owner's collection only.
 * With `collection` and `via` only that related group is read, so its pages follow each other.
 * A collection `exclude` names takes no part: no hit, no related group, no pass.
 */
export async function searchRecords(
  user: User,
  q: string,
  { limit, collection: only, via, offset = 0, exclude = [], signal }: SearchWindow,
): Promise<SearchAnswer> {
  const tokens = searchTokens(q).map((token) => (isUUID(token) ? token.toLowerCase() : token));
  if (isEmpty(tokens)) return { results: [] };
  const collections = describeCollections(user).filter(
    (collection) => !exclude.includes(collection.name),
  );
  const search: Search = {
    user,
    tokens,
    words: tokens.filter((token) => !isUUID(token)),
    identities: tokens.filter((token) => isUUID(token)),
    limit,
    offset,
    signal,
    guards: resolveGuards(),
    collections,
    targets: new Map(),
    probes: new Map(),
    scopes: new Map(),
  };
  if (!isUndefined(via)) return { results: await relatedPage(search, only, via) };
  const sources = collections.filter((collection) => isUndefined(only) || collection.name === only);
  const hits: Hit[] = [];
  const owners = new Map<string, string>();
  for (const collection of sources) {
    if (signal?.aborted === true) break;
    const found = await isolated(`\`${collection.name}\``, [], async () => {
      const target = await searchable(collection, !isEmpty(search.words));
      if (isNull(target) || signal?.aborted === true) return [];
      return readDirect(search, target);
    });
    hits.push(...found);
    if (!isUndefined(only)) continue;
    for (const UUID of await owned(search, collection, found)) owners.set(UUID, collection.name);
  }
  if (!isUndefined(only)) return { results: hits.map((hit) => hit.result) };
  const words = search.words.map((word) => foldCase(word));
  const ranked = isEmpty(words)
    ? hits
    : uniqueArray([...searchByKeywords(hits, words, 'text'), ...hits]);
  const related = await readRelated(search, sources, owners);
  return { ...related, results: [...ranked.map((hit) => hit.result), ...related.results] };
}

/**
 * The collection's search target, or `null` when the tokens may not search it.
 * The read must be allowed and reach, and the scope must leave the `UUID` readable.
 * For `words` it also needs `dashboard.search` on, no singleton, and a label field the scope leaves readable.
 */
async function searchable(
  collection: DashboardCollection,
  words: boolean,
): Promise<Searchable | null> {
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
async function readDirect(search: Search, target: Searchable): Promise<Hit[]> {
  const where = directWhere(search, target);
  if (isNull(where)) return [];
  const { collection, labels } = target;
  const rows = await readRows(search, target, {
    select: ['UUID', ...labels],
    where,
    order: ['-UUID'],
    limit: search.limit,
    offset: search.offset,
  });
  return rows.map((row) => ({
    result: { collection: collection.name, UUID: row.UUID, label: labelOf(target, row) },
    text: foldCase(renderLabel(row, labels)),
  }));
}

/**
 * The condition a direct read sends: every token in the target's own fields, or `null` when one cannot match.
 */
function directWhere(
  { tokens, guards, scopes }: Search,
  { meta, labels }: Searchable,
  budget = Math.floor(guards.maxConditions / tokens.length),
): ConditionObject | null {
  const matches = tokens.map((token) =>
    own(scopes, meta, token, budget, guards.maxHasDepth, labels),
  );
  if (matches.some((match) => isEmpty(match.branches))) return null;
  return { and: matches.map((match) => ({ or: match.branches })) };
}

/**
 * The pasted `UUID`s a collection owns, so their usages are read in that collection alone.
 * A lone `UUID` read from the first window already found its record; otherwise one seek by `UUID` runs.
 */
async function owned(
  search: Search,
  collection: DashboardCollection,
  found: readonly Hit[],
): Promise<string[]> {
  const { identities, tokens, offset } = search;
  if (isEmpty(identities)) return [];
  if (tokens.length === 1 && offset === 0) {
    return intersection(
      found.map((hit) => hit.result.UUID),
      identities,
    );
  }
  return isolated(`\`${collection.name}\``, [], async () => {
    const target = await searchable(collection, false);
    if (isNull(target)) return [];
    const where = { UUID: { in: identities } };
    const rows = await readRows(search, target, {
      select: ['UUID'],
      where,
      limit: identities.length,
    });
    return rows.map((row) => row.UUID);
  });
}

/**
 * Reads the related groups of every source collection, by the source's then the target's registry order.
 * A word group runs only when its target probe hits, and at most `RELATED_PASSES` of them run.
 * A pasted `UUID` runs a group into its owner's collection alone, never probed nor capped.
 */
async function readRelated(
  search: Search,
  sources: readonly DashboardCollection[],
  owners: ReadonlyMap<string, string>,
): Promise<SearchAnswer> {
  const results: SearchResult[] = [];
  let passes = 0;
  let truncated = false;
  for (const collection of sources) {
    if (search.signal?.aborted === true) break;
    const from = await searchable(collection, !isEmpty(search.words));
    if (isNull(from)) continue;
    const grouped = groupBy(
      linkPaths(from.meta, search.guards),
      (path) => path.field.target as string,
    );
    for (const target of search.collections) {
      const paths = grouped[target.name];
      if (isUndefined(paths)) continue;
      const identities = search.identities.filter((token) => owners.get(token) === target.name);
      if (isEmpty(identities) && truncated) continue;
      const name = groupName(collection, target);
      const pair = await isolated(name, null, () =>
        pairOf(search, from, target, paths, identities),
      );
      if (isNull(pair)) continue;
      if (isEmpty(identities) && passes === RELATED_PASSES) {
        truncated = true;
        continue;
      }
      if (isEmpty(identities)) passes += 1;
      results.push(...(await isolated(name, [], () => readPair(search, pair))));
    }
  }
  return truncated ? { results, truncated } : { results };
}

/**
 * Reads one related group, `only` linking into `via`, for the window the request pages.
 * A missing or unknown collection, an unknown target, or one the collection never links to answers nothing.
 */
async function relatedPage(
  search: Search,
  only: string | undefined,
  via: string,
): Promise<SearchResult[]> {
  const collection = search.collections.find((candidate) => candidate.name === only);
  const target = search.collections.find((candidate) => candidate.name === via);
  if (isUndefined(collection) || isUndefined(target)) return [];
  const name = groupName(collection, target);
  return isolated(name, [], async () => {
    const from = await searchable(collection, !isEmpty(search.words));
    if (isNull(from)) return [];
    const paths = linkPaths(from.meta, search.guards).filter((path) => path.field.target === via);
    if (isEmpty(paths)) return [];
    const to = await linkable(search, target);
    if (isNull(to) || !crosses(search, to, paths, search.identities)) return [];
    return readPair(search, { from, to, paths, identities: search.identities });
  });
}

/**
 * The related group of `from` linking into `target`, or `null` when no token can cross into it.
 * Words cross when the target is linkable by words and a path keeps `search` on.
 * A group without a routed `UUID` also needs a probe hit.
 */
async function pairOf(
  search: Search,
  from: Searchable,
  target: DashboardCollection,
  paths: LinkPath[],
  identities: string[],
): Promise<Pair | null> {
  if (search.signal?.aborted === true) return null;
  const to = await linkable(search, target);
  if (isNull(to) || !crosses(search, to, paths, identities)) return null;
  if (isEmpty(identities) && !(await probe(search, to))) return null;
  return { from, to, paths, identities };
}

/**
 * Whether a token can cross `paths` into `to`: a routed `UUID`, or a word through a searchable label.
 */
function crosses(
  search: Search,
  to: Linkable,
  paths: readonly LinkPath[],
  identities: readonly string[],
): boolean {
  if (!isEmpty(identities)) return true;
  return !isEmpty(search.words) && !isEmpty(to.matched) && paths.some((path) => path.words);
}

/**
 * The collection as a link target, resolved once per search, or `null` when its read does not reach.
 * Its words match the label fields the scope leaves readable whose `search` is on.
 * A `dashboard.search` of `false` or `{ via: false }` lets no word cross into it.
 */
function linkable(search: Search, collection: DashboardCollection): Promise<Linkable | null> {
  return getOrSet(search.targets, collection.name, () =>
    searchable(collection, false).then((target) => {
      if (isNull(target)) return null;
      const quiet = useCollections().get(collection.name)?.collection.dashboard?.search;
      const matched = target.labels.filter((name) => target.meta.fields[name]?.search === true);
      return { ...target, matched: isUndefined(quiet) ? matched : [] };
    }),
  );
}

/**
 * Whether any word matches a label of any record `to`'s reach admits, read once per search.
 * A probe past `maxConditions` counts as a hit, so a group is never wrongly skipped.
 */
function probe(search: Search, to: Linkable): Promise<boolean> {
  const name = to.collection.name;
  return getOrSet(search.probes, name, () =>
    isolated(`\`${name}\``, false, async () => {
      const matches = search.words.map((word) => labelMatch(to, word));
      const branches = matches.flatMap((match) => match.branches);
      if (isEmpty(branches)) return false;
      const cost = matches.reduce((sum, match) => sum + match.cost, 0);
      if (cost > search.guards.maxConditions) return true;
      const rows = await readRows(search, to, {
        select: ['UUID'],
        where: { or: branches },
        limit: 1,
      });
      return !isEmpty(rows);
    }),
  );
}

/**
 * Reads one related group: records that match every token on their own or through a link, and no direct hit.
 * Each linked record that matched rides the result's `via`, read in one more pass over the target.
 */
async function readPair(search: Search, pair: Pair): Promise<SearchResult[]> {
  if (search.signal?.aborted === true) return [];
  const pass = relatedPass(search, pair);
  if (isNull(pass)) return [];
  const { from, to } = pair;
  const rows = await readRows(search, from, {
    select: pass.select,
    where: pass.where,
    order: ['-UUID'],
    limit: search.limit,
    offset: search.offset,
  });
  if (isEmpty(rows)) return [];
  const links = rows.map((row) =>
    pass.paths.flatMap((path) =>
      uniqueArray(linkedUUIDs(row, path)).map((UUID) => ({ UUID, path: path.path })),
    ),
  );
  const ids = uniqueArray(links.flat().map((link) => link.UUID));
  const name = groupName(from.collection, to.collection);
  const labels = await isolated(name, new Map(), () => targetLabels(search, pair, ids));
  return rows.map((row, at) => ({
    collection: from.collection.name,
    UUID: row.UUID,
    label: labelOf(from, row),
    via: {
      collection: to.collection.name,
      targets: links[at].flatMap(({ UUID, path }) => {
        const label = labels.get(UUID);
        return isUndefined(label) ? [] : [{ UUID, label, path }];
      }),
    },
  }));
}

/**
 * The condition, select, and link paths of one related read, or `null` when it cannot run.
 *
 * Each token is its own `or`: a branch per link path, then the source's own fields, so tokens split freely.
 * The read excludes the direct read's exact condition, so no record answers in both tiers.
 * The exclusion is priced first; each token shares the conditions left, links first, shallowest first.
 * Every word link repeats the target's reach condition, so the deepest paths drop until the binds fit.
 * A read whose links do not fit at all skips with a `DEBUG` line.
 */
function relatedPass(
  search: Search,
  pair: Pair,
): { where: ConditionObject; select: string[]; paths: LinkPath[] } | null {
  const { tokens, guards } = search;
  const { from, to } = pair;
  const exclusion = exclusionOf(search, from);
  const share = Math.floor((guards.maxConditions - (exclusion?.cost ?? 0)) / tokens.length);
  const reserve = reachBinds(to.reach);
  const window = { limit: search.limit, offset: search.offset };
  for (let paths = pair.paths; ; paths = paths.slice(0, -1)) {
    const links = tokens.map((token) => linkBranches(search, pair, paths, token, share));
    if (links.every((link) => isEmpty(link.branches))) {
      const name = groupName(from.collection, to.collection);
      usePrinter().debug(`Search skipped ${name}: its links do not fit the query limits`);
      return null;
    }
    const matches = links.map((link, at) => [
      ...link.branches,
      ...own(
        search.scopes,
        from.meta,
        tokens[at],
        share - link.cost,
        guards.maxHasDepth,
        from.labels,
      ).branches,
    ]);
    if (matches.some((branches) => isEmpty(branches))) return null;
    const where = {
      and: [
        ...matches.map((branches) => ({ or: branches })),
        ...(isNull(exclusion) ? [] : [exclusion.where]),
      ],
    };
    const crossings = links.reduce((sum, link) => sum + link.crossings, 0);
    const binds =
      readBinds(window, guards, crossings * reserve) + conditionBinds(conditionTree(where));
    if (binds > guards.maxBoundParams) continue;
    const used = paths.filter((path) => links.some((link) => link.paths.includes(path)));
    const roots = used.map((path) => first(path.steps)?.name ?? path.name);
    return { where, select: uniqueArray(['UUID', ...from.labels, ...roots]), paths: used };
  }
}

/**
 * What a related read leaves out: the negated direct condition, within half of `maxConditions`.
 * A direct condition past that half is rebuilt on a smaller budget, labels and shallow fields first.
 * A record matching only through text the smaller budget drops can then show in both tiers.
 */
function exclusionOf(
  search: Search,
  from: Searchable,
): { where: ConditionObject; cost: number } | null {
  const room = Math.floor(search.guards.maxConditions / 2);
  let budget = Math.floor(search.guards.maxConditions / search.tokens.length);
  for (; budget > 0; budget = Math.floor(budget / 2)) {
    const direct = directWhere(search, from, budget);
    if (isNull(direct)) return null;
    const exclusion = excluded(direct, from.meta);
    if (exclusion.cost <= room) return exclusion;
  }
  return null;
}

/**
 * The link branches `token` takes through `paths` within `share` conditions, shallowest path first.
 * A word matches the target's searchable labels inside a `has` on the relation, through each label's hook.
 * A routed `UUID` matches the relation's own value: `equalsTo` on a `record`, `includes` on `records`.
 */
function linkBranches(
  search: Search,
  { to, identities }: Pair,
  paths: readonly LinkPath[],
  token: string,
  share: number,
): Links {
  const found: Links = { branches: [], cost: 0, paths: [], crossings: 0 };
  const identity = isUUID(token);
  if (identity && !identities.includes(token)) return found;
  const label = identity ? null : labelMatch(to, token);
  if (!isNull(label) && isEmpty(label.branches)) return found;
  for (const path of paths) {
    if (!identity && (!path.words || path.steps.length >= search.guards.maxHasDepth)) continue;
    const leaf = isNull(label)
      ? { [path.field.kind === 'records' ? 'includes' : 'equalsTo']: token }
      : { has: { or: label.branches } };
    const overhead = path.steps.reduce((sum, step) => sum + 1 + Object.keys(step.head).length, 0);
    const cost = overhead + 1 + (label?.cost ?? 0);
    if (found.cost + cost > share) continue;
    const branch = path.steps.reduceRight<ConditionObject>(
      (inner, step) => ({ [step.name]: { has: { ...step.head, ...inner } } }),
      { [path.name]: leaf },
    );
    found.branches.push(branch);
    found.cost += cost;
    found.paths.push(path);
    if (!identity) found.crossings += 1;
  }
  return found;
}

/**
 * The `or` branches a word matches in a link target's searchable labels, each through its type's hook.
 */
function labelMatch({ meta, matched }: Linkable, token: string): Branches {
  const found: Branches = { branches: [], cost: 0 };
  for (const name of matched) {
    const field = meta.fields[name];
    const match = field.kind === 'column' ? columnMatch(meta, name, field, token) : null;
    if (isNull(match)) continue;
    found.branches.push(match.branch);
    found.cost += match.cost;
  }
  return found;
}

/**
 * Every relation field a scope's records link through: at the root, in child items, and in block types.
 * Paths come shallowest first, each level within `maxHasDepth`, and at most `maxConditions` scopes per level.
 * A relation enters only when readable and on its owning side; `words` follows `search` down the path.
 */
function linkPaths(root: CollectionQueryMeta, guards: QueryGuards): LinkPath[] {
  const found: LinkPath[] = [];
  let level = [{ scope: root, steps: [] as Step[], prefix: '', words: true }];
  for (let depth = 0; !isEmpty(level); depth += 1) {
    const next: typeof level = [];
    for (const { scope, steps, prefix, words } of level) {
      for (const [name, field] of Object.entries(scope.fields)) {
        if (field.readable === false) continue;
        const open = words && field.search === true;
        const path = `${prefix}${name}`;
        if (field.kind === 'record' || field.kind === 'records') {
          if (field.inverse !== true) found.push({ path, steps, name, field, words: open });
          continue;
        }
        if (depth === guards.maxHasDepth) continue;
        for (const [inner, head] of nestedScopes(scope, name, field)) {
          const block = isString(head.block) ? `${head.block}.` : '';
          const step = { name, head };
          next.push({
            scope: inner,
            steps: [...steps, step],
            prefix: `${path}.${block}`,
            words: open,
          });
        }
      }
    }
    level = next.slice(0, guards.maxConditions);
  }
  return found;
}

/**
 * The `UUID`s a read row links through `path`, walking the hydrated child items and blocks down to it.
 */
function linkedUUIDs(row: Record<string, unknown>, { steps, name }: LinkPath): string[] {
  let items: unknown[] = [row];
  for (const step of steps) {
    const values = items.flatMap((item) => (isPlainObject(item) ? toArray(item[step.name]) : []));
    items = isString(step.head.block)
      ? values.flatMap((item) =>
          isPlainObject(item) && item.block === step.head.block ? [item.fields] : [],
        )
      : values;
  }
  return items.flatMap((item) => (isPlainObject(item) ? toArray(item[name]) : [])).filter(isString);
}

/**
 * The labels of the linked records among `ids` that matched a word or are a routed `UUID`, by `UUID`.
 * It reads under the target's reach, in slices that fit both `maxInLength` and `maxBoundParams`.
 * A read where not even one `UUID` fits skips with a `DEBUG` line.
 */
async function targetLabels(
  search: Search,
  { from, to, identities }: Pair,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const { guards } = search;
  const matched = [
    ...search.words.flatMap((word) => labelMatch(to, word).branches),
    ...(isEmpty(identities) ? [] : [{ UUID: { in: identities } }]),
  ];
  const labels = new Map<string, string>();
  const room =
    guards.maxBoundParams -
    readBinds({ limit: 1 }, guards) -
    conditionBinds(conditionTree({ or: matched }));
  if (room < 1) {
    const name = groupName(from.collection, to.collection);
    usePrinter().debug(`Search skipped the labels of ${name}: they do not fit the query limits`);
    return labels;
  }
  for (const slice of chunk(ids, Math.min(guards.maxInLength, room))) {
    const rows = await readRows(search, to, {
      select: ['UUID', ...to.labels],
      where: { and: [{ UUID: { in: slice } }, { or: matched }] },
      limit: slice.length,
    });
    for (const row of rows) labels.set(row.UUID, labelOf(to, row));
  }
  return labels;
}

/**
 * The negation of a direct read's condition, and the conditions it counts.
 * It stays true over a `NULL`: a negated leaf on a nullable or translated column also admits `isNull`.
 * A negated `has` is a `NOT EXISTS`, already two-valued.
 */
function excluded(
  direct: ConditionObject,
  meta: CollectionQueryMeta,
): { where: ConditionObject; cost: number } {
  const negated = negate(conditionTree(direct), meta);
  let cost = 0;
  walkCondition(negated, (node) => {
    if (node.kind !== 'and' && node.kind !== 'or') cost += 1;
  });
  return { where: serializeCondition(negated) as ConditionObject, cost };
}

/**
 * Negates a condition by De Morgan, guarding each negated column leaf that can read `NULL`.
 */
function negate(node: ConditionNode, meta: CollectionQueryMeta): ConditionNode {
  if (node.kind === 'and' || node.kind === 'or') {
    const kind = node.kind === 'and' ? 'or' : 'and';
    return { kind, nodes: node.nodes.map((child) => negate(child, meta)) };
  }
  const flipped = { ...node, negated: !node.negated };
  if (node.kind !== 'compare' || node.op === 'isNull') return flipped;
  const field = meta.fields[node.path[0]];
  if (!field.nullable && field.companion !== true) return flipped;
  const empty: ConditionNode = { kind: 'compare', path: node.path, op: 'isNull', negated: false };
  return { kind: 'or', nodes: [empty, flipped] };
}

/**
 * The parsed tree of a condition search built itself.
 * A malformed one is a programming error, so it throws.
 */
function conditionTree(where: ConditionObject): ConditionNode {
  const parsed = parseCondition(where);
  if (!parsed.ok) throw ohneError(`Search built a malformed condition (${parsed.error.code})`);
  return parsed.node;
}

/**
 * The bound parameters a reach's condition repeats in each `has` crossing into its collection.
 */
function reachBinds({ where }: QueryScope): number {
  if (isUndefined(where)) return 0;
  const parsed = parseCondition(where);
  return parsed.ok ? conditionBinds(parsed.node) : 0;
}

/**
 * Runs one wire query against a search target under its reach, in the user's content locale.
 * Only rows carrying a `UUID` answer.
 */
async function readRows(
  search: Search,
  { collection, meta, reach }: Searchable,
  query: {
    select: string[];
    where: ConditionObject;
    limit: number;
    order?: string[];
    offset?: number;
  },
): Promise<(Record<string, unknown> & { UUID: string })[]> {
  const locale = contentLocale(search.user, meta);
  const params = { ...query, ...(isUndefined(locale) ? {} : { locale }) };
  const parsed = await parseWireQuery(
    params as Record<string, SearchParamValue>,
    meta,
    search.guards,
    reachOf,
  );
  const rows = (await listRecords(collection.name, parsed, reach)) as Record<string, unknown>[];
  return rows.filter((row): row is Record<string, unknown> & { UUID: string } =>
    isString(row.UUID),
  );
}

/**
 * A read row's label, rendered from the target's readable label fields; `''` when it has none.
 */
function labelOf({ collection, labels }: Searchable, row: Record<string, unknown>): string {
  return isEmpty(labels) ? '' : renderLabel(row, labels, collection.labelTemplate);
}

/**
 * The `or` branches matching `token` in a scope's own fields, and the conditions they count.
 * A `UUID` token matches the scope's own `UUID`.
 * A word matches `labels` first, then every other column search reads, through its type's hook.
 * Each child field and allowed block type follows one `has` deeper.
 * A word never enters a composite whose `search` is off; a `UUID` enters every readable one.
 * A branch that would overrun `budget` drops, and a `has` opens only while `depth` has a level left.
 * Below the root, a scope answers each token, budget and depth once per search, from `scopes`.
 */
function own(
  scopes: Search['scopes'],
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
      const share = budget - found.cost - overhead;
      const memo = getOrSet(scopes, inner.fields, () => new Map<string, Branches>());
      const nested = getOrSet(memo, `${token}\0${share}\0${depth - 1}`, () =>
        own(scopes, inner, token, share, depth - 1),
      );
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
    skipped(`\`${collection}\``, error);
    return false;
  }
}

/**
 * Runs one read, answering `fallback` with a `DEBUG` line naming it when it refuses with an `HTTPError`.
 * Any other throw propagates, so a misconfiguration stays a `500`.
 */
async function isolated<T>(name: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof HTTPError)) throw error;
    skipped(name, error);
    return fallback;
  }
}

/**
 * The name a `DEBUG` line gives the related group of `collection` linking into `target`.
 */
function groupName(collection: DashboardCollection, target: DashboardCollection): string {
  return `\`${collection.name}\` via \`${target.name}\``;
}

/**
 * Prints the `DEBUG` line for a read a search skips over an `HTTPError`.
 */
function skipped(name: string, error: HTTPError): void {
  usePrinter().debug(`Search skipped ${name}: its read answered \`${error.status}\``);
}

/**
 * The registered name of a field's type, for an error to name it.
 */
function typeName(field: FieldQueryMeta): string {
  const types = Object.values(useFields().all());
  return types.find((type) => type.fieldType === field.fieldType)?.name ?? 'unknown';
}
