import type { CollectionQueryMeta, QueryScope } from 'ohnejs';
import type { User } from 'ohnejs/auth';
import type { HTTPMethod } from 'ohnejs/utils';

import { queryMetadata, resolveGuards, routeID, useEvent, useRoutes, useSkills } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { compileRoute, isArray, isEmpty, isNull, isPlainObject, isUndefined } from 'ohnejs/utils';

import type { DashboardCollection, DashboardField } from '../../base/collections-api/describe.ts';
import type { AITier } from '../config.ts';

import { describeCollections } from '../../base/collections-api/describe.ts';
import { readScope, writeReach } from '../../base/collections-api/gate.ts';
import { defaultLanguage, resolveMessage } from '../../ohne/http/translate.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { useAIConfig } from '../config.ts';
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
 * - `app`: any JSON object, since the route is the app's own.
 */
export type BodyShape = 'query' | 'verdicts' | 'record' | 'copy' | 'none' | 'app';

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
}

interface ShippedRoute {
  needs: keyof ReachableCollection['operations'];
  translatable?: true;
  query: readonly string[];
  body: BodyShape;
}

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

const OPERATION_WORDS = { read: 'query', create: 'create', update: 'update', delete: 'delete' };

const LISTING = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * Renders the surface for `user`: locales, limits, the routes and collections they reach, and their skills.
 * A collection `ai.deny.collections` lists never appears, whatever the person may do with it.
 * A route appears when `ai.routes` gives it a tier and the person may run its operation on that collection.
 * Fields outside the person's read scope stay out, as do the ones no read returns.
 * `values` is whether the turn's model may see record values; a blind one reads no opened field.
 * The text is in the app's default language, so it reads the same for everyone with the same reach.
 * Valid only within a request.
 */
export function renderSurface(user: User, values: boolean): Promise<Surface> {
  return inDefaultLanguage(async () => {
    const collections = await reachableCollections(user, values);
    const routes = offeredRoutes(collections);
    const text = [
      appBlock(collections),
      routesBlock(routes),
      collectionsBlock(collections),
      skillsBlock(user),
    ]
      .filter((block) => block !== '')
      .join('\n\n');
    return { text, routes, collections };
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
}: ReachableCollection): string {
  const lines = [`## ${collectionHeading(described)}`, collectionFacts(described, opened)];
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
 * The collections `user` reaches, each with its scope, its admitted operations, and its opened fields.
 */
async function reachableCollections(
  user: User,
  values: boolean,
): Promise<Map<string, ReachableCollection>> {
  const denied = new Set(useAIConfig().deny.collections);
  const reachable = new Map<string, ReachableCollection>();
  for (const described of describeCollections(user)) {
    if (denied.has(described.name)) continue;
    const { name, operations } = described;
    const scope = operations.read?.allowed === true ? await readScope(name) : false;
    const admitted = {
      read: scope !== false,
      create: operations.create?.allowed === true,
      update: operations.update?.allowed === true && (await writeReach(name, 'update')) !== false,
      delete: operations.delete?.allowed === true && (await writeReach(name, 'delete')) !== false,
    };
    if (!Object.values(admitted).some(Boolean)) continue;
    const opened = values && scope !== false ? openedFields(name, scope) : [];
    reachable.set(name, {
      described,
      meta: queryMetadata(name),
      scope,
      operations: admitted,
      opened,
    });
  }
  return reachable;
}

/**
 * The routes the person may propose: each registered route the table tiers, per reachable collection.
 * A route shaped like a collections route that the framework does not ship is never offered.
 */
function offeredRoutes(collections: Map<string, ReachableCollection>): Map<string, OfferedRoute> {
  const routes = Object.values(useRoutes().all());
  const offered = new Map<string, OfferedRoute>();
  const add = (route: OfferedRoute): void => void offered.set(route.id, route);
  for (const { described, meta, operations } of collections.values()) {
    for (const { method, pattern } of routes) {
      const shipped = SHIPPED[routeID(method, pattern)];
      if (isNull(method) || isUndefined(shipped)) continue;
      const tier = tierOf(method, pattern);
      if (tier === false || isUndefined(tier)) continue;
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
    const tier = tierOf(method, pattern);
    if (tier === false || isUndefined(tier)) continue;
    add({
      id: routeID(method, pattern),
      method,
      pattern,
      tier,
      params: compileRoute(pattern).params,
      query: [],
      body: 'app',
    });
  }
  return offered;
}

/**
 * The `# This app` block: locales, limits, and what the model receives.
 */
function appBlock(collections: Map<string, ReachableCollection>): string {
  const { locales, defaultLocale } = queryLocales();
  const { limits } = useAIConfig();
  const { maxPerPage } = resolveGuards();
  return [
    '# This app',
    `Locales: ${locales.map((locale) => (locale === defaultLocale ? `${locale} (default)` : locale)).join(', ')}.`,
    `Limits: perPage at most ${maxPerPage}. At most ${limits.requests} requests per step. The person approves every write.`,
    dataLine(collections),
  ].join('\n');
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
 * The `# Your routes` block, one id per line.
 */
function routesBlock(routes: Map<string, OfferedRoute>): string {
  const ids = [...routes.keys()];
  return ['# Your routes', ...(isEmpty(ids) ? ['(none)'] : ids)].join('\n');
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
 * The facts line of a collection: its label fields, whether it is translatable, and its opened fields.
 */
function collectionFacts(
  { labelFields, translatable }: DashboardCollection,
  opened: readonly string[],
): string {
  const facts: string[] = [];
  if (!isEmpty(labelFields)) facts.push(`Label: ${labelFields.join(', ')}.`);
  if (translatable) facts.push('Translatable.');
  if (!isEmpty(opened)) facts.push(`Data: ${opened.join(', ')}.`);
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
 * What follows a field's flags: its choices, its range, or its unit.
 */
function fieldDetail(field: DashboardField): string {
  const options = field.options ?? {};
  const choices = options.choices;
  if (isArray(choices)) {
    const values = choices.map((choice) => (isPlainObject(choice) ? choice.value : choice));
    return `: ${values.join(' | ')}`;
  }
  const { min, max } = options;
  if (!isUndefined(min) && !isUndefined(max)) return `, ${min} to ${max}`;
  if (!isUndefined(min)) return `, at least ${min}`;
  if (!isUndefined(max)) return `, at most ${max}`;
  if (field.type === 'dateTime') return ' (epoch ms)';
  return '';
}
