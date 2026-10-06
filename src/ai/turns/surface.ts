import type { CollectionQueryMeta, FlowTier, QueryScope } from 'ohnejs';
import type { User } from 'ohnejs/auth';
import type { HTTPMethod, RichTextOptions } from 'ohnejs/utils';

import {
  queryMetadata,
  resolveGuards,
  routeID,
  useCollections,
  useEvent,
  useRoutes,
  useSkills,
} from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import {
  capitalize,
  compileRoute,
  isArray,
  isBoolean,
  isEmpty,
  isLocalPath,
  isNull,
  isPlainObject,
  isUndefined,
  uniqueArray,
} from 'ohnejs/utils';
import { literalUnion } from 'ohnejs/utils/codegen';

import type { DashboardCollection, DashboardField } from '../../base/collections-api/describe.ts';
import type { AIAskKind, AITier } from '../config.ts';

import { accountFields, accountLayout } from '../../base/auth/account-layout.ts';
import { describeCollections } from '../../base/collections-api/describe.ts';
import { readScope, writeReach } from '../../base/collections-api/gate.ts';
import { resolveDashboardMenu } from '../../base/menu/resolve-menu.ts';
import { registeredLinks } from '../../ohne/fields/link-collections.ts';
import { defaultLanguage, resolveMessage, translate } from '../../ohne/http/translate.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { useAIConfig } from '../config.ts';
import { autoAccepts } from './auto-accept.ts';
import { openedFields, SYSTEM_FIELDS } from './redact.ts';
import { tierOf } from './tiers.ts';

/**
 * What a route's body carries, which decides how a proposal's `body` is checked.
 *
 * - `query`: a wire query, as the list read takes it.
 * - `verdicts`: `where` or `UUIDs`, with a `locale`.
 * - `record`: a record's fields, as a create or update takes them.
 * - `copy`: an optional `source` locale.
 * - `none`: nothing.
 * - `search`: a `POST /search` body, `q` with an optional `collection`, `via`, `limit` and `offset`.
 * - `app`: any JSON object, since the route is the app's own.
 */
export type BodyShape = 'query' | 'verdicts' | 'record' | 'copy' | 'none' | 'search' | 'app';

/**
 * One route the assistant may propose, as the surface lists it.
 */
export interface OfferedRoute {
  /**
   * The id the model proposes, the method and the pattern with the collection segment filled in.
   *
   * @example
   * ```ts
   * 'PATCH /collections/items/[uuid]'
   * ```
   */
  id: string;

  /**
   * The route's method.
   */
  method: HTTPMethod;

  /**
   * The registered pattern, its `[collection]` still literal on a collections route.
   */
  pattern: string;

  /**
   * The tier `ai.routes` gives the route.
   */
  tier: AITier;

  /**
   * The params a proposal fills, the collection segment aside.
   */
  params: readonly string[];

  /**
   * The query keys a proposal may carry.
   */
  query: readonly string[];

  /**
   * What the body carries.
   */
  body: BodyShape;

  /**
   * The collection a collections route addresses; absent on an app route.
   */
  collection?: string;
}

/**
 * One collection the assistant may work with, with what the person reaches in it.
 */
export interface ReachableCollection {
  /**
   * The collection as the dashboard describes it for the person.
   */
  described: DashboardCollection;

  /**
   * The collection's query metadata.
   */
  meta: CollectionQueryMeta;

  /**
   * The person's read scope, or `false` when their read is refused.
   */
  scope: QueryScope | false;

  /**
   * Which operations the person may run, their `access` verdict included.
   */
  operations: Record<'read' | 'create' | 'update' | 'delete', boolean>;

  /**
   * The fields whose values reach the model, in declared order; empty for a collection it reads blind.
   */
  opened: readonly string[];

  /**
   * The text fields a transform may rewrite, in declared order; empty when none may.
   * They are the opened fields the person may update, as text, and that a model may see.
   * Under a blind turn model they exist only while `ai.transform.model` pins a model that sees values.
   */
  rewritable: readonly string[];
}

/**
 * The surface of one turn: what the model reads about the app, and what the server checks proposals against.
 */
export interface Surface {
  /**
   * The rendered block, in the default language.
   */
  text: string;

  /**
   * The routes the model may propose, by id.
   */
  routes: ReadonlyMap<string, OfferedRoute>;

  /**
   * The collections the model may reach, by name.
   */
  collections: ReadonlyMap<string, ReachableCollection>;

  /**
   * Each dashboard path the person may open, mapped to its label in the default language.
   */
  pages: ReadonlyMap<string, string>;

  /**
   * Whether the person's writes may run without asking, as `autoAccepts` answers it.
   */
  autoAccept: boolean;
}

interface ShippedRoute {
  needs: keyof ReachableCollection['operations'];
  translatable?: true;
  query: readonly string[];
  body: BodyShape;
}

/**
 * The dashboard's search, which finds records by text across every collection.
 */
const SEARCH_ROUTE = 'POST /search';

/**
 * The shipped collections routes: the operation each needs, and what a proposal to it may carry.
 */
const SHIPPED: Readonly<Record<string, ShippedRoute>> = {
  'POST /collections/[collection]/query': { needs: 'read', query: [], body: 'query' },
  'POST /collections/[collection]/verdicts': { needs: 'read', query: [], body: 'verdicts' },
  'GET /collections/[collection]/[uuid]': {
    needs: 'read',
    query: ['select', 'populate', 'locale'],
    body: 'none',
  },
  'GET /collections/[collection]/[uuid]/translations': {
    needs: 'read',
    translatable: true,
    query: [],
    body: 'none',
  },
  'POST /collections/[collection]': { needs: 'create', query: ['locale'], body: 'record' },
  'PATCH /collections/[collection]/[uuid]': { needs: 'update', query: ['locale'], body: 'record' },
  'DELETE /collections/[collection]/[uuid]': { needs: 'delete', query: [], body: 'none' },
  'DELETE /collections/[collection]/[uuid]/translations': {
    needs: 'delete',
    translatable: true,
    query: ['locale'],
    body: 'none',
  },
  'POST /collections/[collection]/[uuid]/translations/copy': {
    needs: 'update',
    translatable: true,
    query: ['locale'],
    body: 'copy',
  },
};

/**
 * The pages never offered: signing in, signing out, and installing are the person's own acts.
 */
const CLOSED_PAGES = new Set(['/login', '/logout', '/install']);

const OPERATION_WORDS = { read: 'query', create: 'create', update: 'update', delete: 'delete' };

const LISTING = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * The addresses a link's `url` may hold, as `isSafeHref` admits them.
 */
const URL_FORMS = 'url: https, http, mailto or tel, a /path or a #fragment';

/**
 * The words the `Limits:` line names each kind of write that always asks by.
 */
const ASK_WORDS: Readonly<Record<AIAskKind, string>> = {
  destructive: 'destructive requests',
  set: 'writes by `where`',
  locale: 'writes at another locale',
  transform: 'rewrites',
};

/**
 * Renders the surface for `user`: locales, limits, the routes, collections and pages they reach, and skills.
 * The limits state which writes run without asking, once the person turned auto-accept on.
 * A collection `ai.deny.collections` lists never appears, whatever the person may do with it.
 * A route appears when `ai.routes` gives it a tier and the person may run its operation on that collection.
 * With `tiers`, a flow node's, only the routes of those tiers appear, so the node can propose no other.
 * Fields outside the person's read scope stay out, as do the ones no read returns.
 * The pages are the person's sidebar rows and their account page, never a denied collection's.
 * `values` is whether the turn's model may see record values; a blind one reads no opened field.
 * The text is in the app's default language, so it reads the same for everyone with the same reach.
 * Valid only within a request.
 */
export function renderSurface(
  user: User,
  values: boolean,
  tiers?: readonly FlowTier[],
): Promise<Surface> {
  return inDefaultLanguage(async () => {
    const described = describeCollections(user);
    const collections = await reachableCollections(described, values);
    const routes = offeredRoutes(collections, tiers);
    const pages = await offeredPages(user, described);
    const autoAccept = await autoAccepts(user);
    const text = [
      appBlock(collections, autoAccept),
      routesBlock(routes),
      pagesBlock(pages),
      collectionsBlock(collections),
      skillsBlock(user),
    ]
      .filter((block) => block !== '')
      .join('\n\n');
    return { text, routes, collections, pages, autoAccept };
  });
}

/**
 * The surface block describing one reachable collection, as the `describe` tool answers it.
 */
export function describeCollection({
  described,
  meta,
  scope,
  opened,
  rewritable,
}: ReachableCollection): string {
  const lines = [
    `## ${collectionHeading(described)}`,
    collectionFacts(described, opened, rewritable),
  ];
  const hidden = scope === false || isUndefined(scope.select) ? null : new Set(scope.select);
  for (const field of described.fields) {
    if (SYSTEM_FIELDS.has(field.name) || !field.readable) continue;
    if (!isNull(hidden) && !hidden.has(field.name)) continue;
    lines.push(`- ${fieldLine(field, meta)}`);
  }
  return lines.join('\n');
}

/**
 * Runs `run` with the request's language set to the app's default, restoring it afterwards.
 */
async function inDefaultLanguage<T>(run: () => Promise<T>): Promise<T> {
  const { context } = useEvent();
  const previous = context.locale;
  context.locale = defaultLanguage();
  try {
    return await run();
  } finally {
    context.locale = previous;
  }
}

/**
 * The collections of `described` the person reaches, with scope, admitted operations and opened fields.
 */
async function reachableCollections(
  described: readonly DashboardCollection[],
  values: boolean,
): Promise<Map<string, ReachableCollection>> {
  const { deny, transform } = useAIConfig();
  const denied = new Set(deny.collections);
  const rewrites = values || !isUndefined(transform.model);
  const reachable = new Map<string, ReachableCollection>();
  for (const collection of described) {
    if (denied.has(collection.name)) continue;
    const { name, operations } = collection;
    const scope = operations.read?.allowed === true ? await readScope(name) : false;
    const update = operations.update?.allowed === true ? await writeReach(name, 'update') : false;
    const admitted = {
      read: scope !== false,
      create: operations.create?.allowed === true,
      update: update !== false,
      delete: operations.delete?.allowed === true && (await writeReach(name, 'delete')) !== false,
    };
    if (!Object.values(admitted).some(Boolean)) continue;
    const opened = values && scope !== false ? openedFields(name, scope) : [];
    const rewritable =
      rewrites && scope !== false && update !== false
        ? rewritableFields(collection, openedFields(name, scope), update)
        : [];
    reachable.set(name, {
      described: collection,
      meta: queryMetadata(name),
      scope,
      operations: admitted,
      opened,
      rewritable,
    });
  }
  return reachable;
}

/**
 * The pages the person may open, by path: their sidebar rows, then their account page when they have one.
 * A row off this origin, a closed page, or one under a denied collection is left out.
 * A denied collection owns its `/collections/<segment>` pages and the page its `recordPath` opens.
 * A repeated path keeps its first label.
 */
async function offeredPages(
  user: User,
  described: DashboardCollection[],
): Promise<Map<string, string>> {
  const denied = new Set(useAIConfig().deny.collections);
  const closed = described
    .filter((collection) => denied.has(collection.name))
    .flatMap((collection) => [
      `/collections/${collection.segment}`,
      ...(isUndefined(collection.recordPath)
        ? []
        : [collection.recordPath.split(/[?#]/, 1)[0].replace(/\/\[uuid\].*$/, '')]),
    ])
    .filter((prefix) => prefix !== '' && prefix !== '/');
  const pages = new Map<string, string>();
  for (const { items } of await resolveDashboardMenu(user, described)) {
    for (const { to, label } of items) {
      const path = to.split(/[?#]/, 1)[0];
      if (pages.has(to) || !isLocalPath(to) || CLOSED_PAGES.has(path)) continue;
      if (closed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
      pages.set(to, label);
    }
  }
  if (!pages.has('/account') && (await hasAccountPage(user))) {
    pages.set('/account', translate('dashboard.account.title'));
  }
  return pages;
}

/**
 * Whether `user` has an account page: the `Users` collection exists and its layout places a field they edit.
 */
async function hasAccountPage(user: User): Promise<boolean> {
  if (isUndefined(useCollections().get('Users'))) return false;
  return accountFields(await accountLayout(user)).length > 0;
}

/**
 * The text fields among `opened` the person may write under their update `scope`, in declared order.
 */
function rewritableFields(
  { fields }: DashboardCollection,
  opened: readonly string[],
  scope: QueryScope,
): string[] {
  const writable = isUndefined(scope.select) ? null : new Set(scope.select);
  return fields
    .filter(
      (field) =>
        opened.includes(field.name) &&
        field.type === 'text' &&
        field.writable &&
        !field.immutable &&
        (isNull(writable) || writable.has(field.name)),
    )
    .map((field) => field.name);
}

/**
 * The routes the person may propose: each registered route the table tiers, per reachable collection.
 * A route shaped like a collections route that the framework does not ship is never offered.
 * With `tiers`, a route of any other tier is left out.
 */
function offeredRoutes(
  collections: Map<string, ReachableCollection>,
  tiers?: readonly FlowTier[],
): Map<string, OfferedRoute> {
  const routes = Object.values(useRoutes().all());
  const offered = new Map<string, OfferedRoute>();
  const add = (route: OfferedRoute): void => void offered.set(route.id, route);
  const open = (tier: AITier | false | undefined): tier is AITier =>
    tier !== false && !isUndefined(tier) && (isUndefined(tiers) || tiers.includes(tier));
  for (const { described, meta, operations } of collections.values()) {
    for (const { method, pattern } of routes) {
      const shipped = SHIPPED[routeID(method, pattern)];
      if (isNull(method) || isUndefined(shipped)) continue;
      const tier = tierOf(method, pattern);
      if (!open(tier)) continue;
      if (!operations[shipped.needs]) continue;
      if (shipped.translatable && meta.translatable !== true) continue;
      add({
        id: routeID(method, pattern.replace('[collection]', described.segment)),
        method,
        pattern,
        tier,
        params: compileRoute(pattern).params.filter((name) => name !== 'collection'),
        query: shipped.query,
        body: shipped.body,
        collection: described.name,
      });
    }
  }
  for (const { method, pattern } of routes) {
    if (isNull(method) || pattern.includes('[collection]')) continue;
    if (routeID(method, pattern) === SEARCH_ROUTE && collections.size === 0) continue;
    const tier = tierOf(method, pattern);
    if (!open(tier)) continue;
    add({
      id: routeID(method, pattern),
      method,
      pattern,
      tier,
      params: compileRoute(pattern).params,
      query: [],
      body: routeID(method, pattern) === SEARCH_ROUTE ? 'search' : 'app',
    });
  }
  return offered;
}

/**
 * The `# This app` block: locales, limits, what the model receives, and what a transform may rewrite.
 * `autoAccept` is whether the person's writes may run without asking.
 */
function appBlock(collections: Map<string, ReachableCollection>, autoAccept: boolean): string {
  const { locales, defaultLocale } = queryLocales();
  const { limits } = useAIConfig();
  const { maxPerPage } = resolveGuards();
  return [
    '# This app',
    `Locales: ${locales.map((locale) => (locale === defaultLocale ? `${locale} (default)` : locale)).join(', ')}.`,
    `Limits: perPage at most ${maxPerPage}. At most ${limits.requests} requests per step, ${limits.transform} records per transform. ${approvalSentence(collections, autoAccept)}`,
    dataLine(collections),
    rewritableLine(collections),
  ].join('\n');
}

/**
 * The sentence of the `Limits:` line on approval: every write asks, or which run without asking.
 * Only the collections the person may write are named.
 */
function approvalSentence(
  collections: Map<string, ReachableCollection>,
  autoAccept: boolean,
): string {
  const { max, fields, ask } = useAIConfig().autoAccept;
  const covered = Object.entries(fields as Record<string, true | string[] | undefined>)
    .filter(([name, listed]) => !isUndefined(listed) && writes(collections.get(name)))
    .map(([name, listed]) => `${name} (${listed === true ? 'every field' : listed?.join(', ')})`);
  if (!autoAccept || isEmpty(covered)) return 'The person approves every write.';
  const asking = uniqueArray<AIAskKind>([...ask, 'set', 'transform']).map(
    (kind) => ASK_WORDS[kind],
  );
  return `A write whose body names only these fields runs without asking, at most ${max} per turn: ${LISTING.format(covered)}. ${capitalize(LISTING.format(asking))} always ask. The person approves every other write.`;
}

/**
 * Whether the person may create, update or delete in `collection`; `false` for one out of reach.
 */
function writes(collection: ReachableCollection | undefined): boolean {
  if (isUndefined(collection)) return false;
  const { create, update, delete: remove } = collection.operations;
  return create || update || remove;
}

/**
 * The `Rewritable:` line: the collections and text fields a transform may rewrite, or that none may.
 */
function rewritableLine(collections: Map<string, ReachableCollection>): string {
  const sources = [...collections.values()]
    .filter(({ rewritable }) => !isEmpty(rewritable))
    .map(({ described, rewritable }) => `${described.name} (${rewritable.join(', ')})`);
  if (isEmpty(sources)) {
    return 'Rewritable: nothing; you cannot translate or rewrite text here.';
  }
  return `Rewritable: ${LISTING.format(sources)}.`;
}

/**
 * The `Data:` line: the collections whose values the model receives, with their fields, or the blind rule.
 */
function dataLine(collections: Map<string, ReachableCollection>): string {
  const sources = [...collections.values()]
    .filter(({ opened }) => !isEmpty(opened))
    .map(({ described, opened }) => `${described.name} (${opened.join(', ')})`);
  if (isEmpty(sources)) {
    return 'Data: you receive status, counts and ids only, never a field value; you can find, count and change records, never read or translate them.';
  }
  return `Data: you receive field values from ${LISTING.format(sources)}. From every other collection you receive status, counts and ids only; you can find, count and change such records, never read or translate them.`;
}

/**
 * The `# Your routes` block, one id per line, then how to search when the search is offered.
 */
function routesBlock(routes: Map<string, OfferedRoute>): string {
  const ids = [...routes.keys()];
  const search = routes.has(SEARCH_ROUTE)
    ? [
        '',
        `\`${SEARCH_ROUTE}\` with \`{ q }\` finds records holding every word of \`q\` in any text field; \`collection\` narrows it, \`limit\` and \`offset\` page it.`,
        'A result with `via` did not match on its own: some words matched a record it links to, in the collection `via` names.',
        'Page a related group with `collection` and `via`.',
        'A whole UUID finds that record and the records that link to it.',
        'Its receipt counts what each collection found under `found`, and what it found through links under `related`, by collection and then by `via`.',
        'It names the records only where their data is open to you, and is `truncated` when related groups were left out.',
        'A count at `limit` (default 5, at most 50) means more may match: page on with `offset`.',
      ]
    : [];
  return ['# Your routes', ...(isEmpty(ids) ? ['(none)'] : ids), ...search].join('\n');
}

/**
 * The `# Your pages` block, one `- path: label` line per page; empty without pages.
 */
function pagesBlock(pages: Map<string, string>): string {
  if (pages.size === 0) return '';
  return ['# Your pages', ...[...pages].map(([path, label]) => `- ${path}: ${label}`)].join('\n');
}

/**
 * The `# Your collections` block, one `describeCollection` per reachable collection.
 */
function collectionsBlock(collections: Map<string, ReachableCollection>): string {
  if (collections.size === 0) return '';
  return ['# Your collections', ...[...collections.values()].map(describeCollection)].join('\n\n');
}

/**
 * The `# Skills` block: every skill the person may start, with its description.
 */
function skillsBlock(user: User): string {
  const lines = Object.values(useSkills().all())
    .filter(({ skill }) => isUndefined(skill.capability) || userCan(user, skill.capability))
    .map(({ name, skill }) => `- ${name}: ${resolveMessage(skill.description)}`);
  return isEmpty(lines) ? '' : ['# Skills', ...lines].join('\n');
}

/**
 * The heading of a collection: its name, segment, and the operations the person may run.
 */
function collectionHeading({ name, segment, operations }: DashboardCollection): string {
  const words = Object.entries(OPERATION_WORDS)
    .filter(([operation]) => operations[operation as keyof typeof OPERATION_WORDS]?.allowed)
    .map(([, word]) => word);
  const scoped = Object.values(operations).some((operation) => operation?.scoped);
  const reach = scoped ? ' Some rows may be out of your reach: ask `verdicts` first.' : '';
  return `${name} (\`${segment}\`): ${words.join(', ')}.${reach}`;
}

/**
 * The facts line of a collection: label fields, translatable or not, the opened and the rewritable fields.
 */
function collectionFacts(
  { labelFields, translatable }: DashboardCollection,
  opened: readonly string[],
  rewritable: readonly string[],
): string {
  const facts: string[] = [];
  if (!isEmpty(labelFields)) facts.push(`Label: ${labelFields.join(', ')}.`);
  if (translatable) facts.push('Translatable.');
  if (!isEmpty(opened)) facts.push(`Data: ${opened.join(', ')}.`);
  if (!isEmpty(rewritable)) facts.push(`Rewritable: ${rewritable.join(', ')}.`);
  return facts.join(' ');
}

/**
 * One field as the model reads it: its name, type, flags, choices or range, and description.
 */
function fieldLine(field: DashboardField, meta: CollectionQueryMeta): string {
  const flags = [
    field.required ? 'required' : '',
    field.nullable ? 'nullable' : '',
    field.unique ? 'unique' : '',
    field.translatable ? 'translatable' : '',
    field.immutable ? 'immutable' : '',
  ].filter((flag) => flag !== '');
  const shape = [fieldType(field, meta), ...flags].join(', ');
  const detail = fieldDetail(field);
  const description = isUndefined(field.description) ? '' : ` - ${field.description}`;
  return `${field.name}: ${shape}${detail}${description}`;
}

/**
 * The type word of a field: a relation names its target, a composite lists its subfields.
 */
function fieldType(field: DashboardField, meta: CollectionQueryMeta): string {
  if (field.kind === 'record' || field.kind === 'records') {
    return `${field.kind} -> ${field.target}`;
  }
  if (field.kind === 'childOne' || field.kind === 'childMany') {
    const names = Object.keys(meta.fields[field.name]?.subfields ?? {}).filter(
      (name) => name !== 'UUID',
    );
    return `${field.type} (${names.join(', ')})`;
  }
  if (field.kind === 'blocks') return `blocks: ${(field.allow ?? []).join(' | ')}`;
  return field.type ?? field.kind;
}

/**
 * What follows a field's flags: its choices, its range, its unit, or the JSON shape of its value.
 */
function fieldDetail(field: DashboardField): string {
  const options = field.options ?? {};
  const choices = options.choices;
  if (isArray(choices)) {
    const values = choices.map((choice) => (isPlainObject(choice) ? choice.value : choice));
    return `: ${values.join(' | ')}`;
  }
  const range = rangeOf(options);
  if (field.type === 'richText') return `${range} (value: ${richTextShape(options)})`;
  if (field.type === 'link') {
    const collections = (options.collections as readonly string[] | undefined) ?? true;
    return ` (value: ${linkShape(collections)}; ${URL_FORMS})`;
  }
  if (range === '' && field.type === 'dateTime') return ' (epoch ms)';
  return range;
}

/**
 * The bounds a field's `min` and `max` set, or `''` when it has neither.
 */
function rangeOf({ min, max }: Readonly<Record<string, unknown>>): string {
  if (!isUndefined(min) && !isUndefined(max)) return `, ${min} to ${max}`;
  if (!isUndefined(min)) return `, at least ${min}`;
  if (!isUndefined(max)) return `, at most ${max}`;
  return '';
}

/**
 * A `richText` value as a TypeScript-like shape, narrowed to the field's elements, marks and links.
 * Its options arrive resolved, so each one the shape reads is present.
 */
function richTextShape(options: Readonly<Record<string, unknown>>): string {
  const { inline, elements, marks, links } = options as Required<RichTextOptions>;
  const allowed = new Set<string>(inline ? [] : elements);
  const kinds = allowed.has('blockquote') ? "'paragraph' | 'quote'" : "'paragraph'";
  const blocks = [`{ kind: ${kinds}, content: Run[] }`];
  const levels = [...allowed].filter((name) => /^h\d$/.test(name)).map((name) => name.slice(1));
  if (!isEmpty(levels)) {
    blocks.push(`{ kind: 'heading', level: ${levels.join(' | ')}, content: Run[] }`);
  }
  const ordered = [allowed.has('ul') ? 'false' : '', allowed.has('ol') ? 'true' : ''].filter(
    (value) => value !== '',
  );
  if (!isEmpty(ordered)) blocks.push('List');
  const run = [
    'text',
    isEmpty(marks) ? '' : `marks?: (${literalUnion([...marks])})[]`,
    links === false ? '' : `link?: ${linkShape(links)}`,
  ];
  return [
    inline ? `[${blocks[0]}]` : `(${blocks.join(' | ')})[]`,
    isEmpty(ordered)
      ? ''
      : `List = { kind: 'list', ordered: ${ordered.join(' | ')}, items: { content: Run[], list?: List }[] }`,
    `Run = { ${run.filter((part) => part !== '').join(', ')} }`,
    links === false ? '' : URL_FORMS,
  ]
    .filter((part) => part !== '')
    .join('; ');
}

/**
 * A link as a TypeScript-like shape: a URL, or a record in one of the registered `collections`.
 */
function linkShape(collections: boolean | readonly string[]): string {
  const url = '{ url, newTab? }';
  const names = registeredLinks(collections);
  if (isBoolean(names) || isEmpty(names)) return url;
  return `${url} | { collection: ${literalUnion([...names])}, record: UUID, hash?, newTab? }`;
}
