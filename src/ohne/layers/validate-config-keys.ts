import type { ResolvedLayer } from '../project/resolve-layer-stack.ts';
import type { Config } from './config.ts';

import {
  didYouMean,
  hasKey,
  isPlainObject,
  isUndefined,
  joinPath,
  mapValues,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DEFAULTS, DIR_DEFAULTS } from './config.ts';

type KeyTree = { [key: string]: true | KeyTree };

type Section<T> = Record<keyof NonNullable<T>, true | KeyTree>;

const leaf = () => true as const;

const FRAMEWORK_KEYS: KeyTree = {
  layers: true,
  dirs: mapValues(DIR_DEFAULTS, leaf) satisfies Section<Config['dirs']>,
  disable: mapValues(DEFAULTS.disable, leaf) satisfies Section<Config['disable']>,
  collections: { locales: true, defaultLocale: true } satisfies Section<Config['collections']>,
  messages: { defaultLanguage: true } satisfies Section<Config['messages']>,
  api: {
    ...mapValues(DEFAULTS.api, leaf),
    port: true,
    host: true,
    rateLimitStore: true,
    rateLimitDatabase: true,
  } satisfies Section<Config['api']>,
  dashboard: {
    port: true,
    host: true,
    apiURL: true,
    origin: true,
    frameAncestors: true,
    menu: true,
  } satisfies Section<Config['dashboard']>,
  database: {
    dialect: true,
    url: true,
    helpers: true,
    sync: { force: true } satisfies Section<NonNullable<Config['database']>['sync']>,
  } satisfies Section<Config['database']>,
  query: { guards: true } satisfies Section<Config['query']>,
  printer: { silent: true, debug: true } satisfies Section<Config['printer']>,
};

/**
 * Throws on the first config key that no layer in `stack` declares.
 *
 * A root key is known when it is a framework key, or a layer declares it in `defaults` or `strategies`.
 * Framework sections are checked down to their leaves.
 * A section a layer declares is its own, so its nested keys are not checked.
 * The error names the config of the layer that sets the key, with the nearest known key as a hint.
 *
 * @example
 * ```ts
 * validateConfigKeys(await resolveLayerStack())
 * // -> throws "Unknown config key `databse`" for a config that sets `databse`
 * ```
 */
export function validateConfigKeys(stack: ResolvedLayer[]): void {
  const roots: KeyTree = {};
  for (const layer of stack) {
    for (const key of Object.keys(layer.defaults)) roots[key] = true;
    for (const path of Object.keys(layer.strategies)) roots[path.split('.')[0] as string] = true;
  }
  Object.assign(roots, FRAMEWORK_KEYS);
  for (const layer of stack) {
    checkKeys(layer.input, roots, [], joinPath(layer.dir, 'ohne.config.ts'));
  }
}

/**
 * Walks `value` against `tree`, descending while both sides are objects.
 */
function checkKeys(value: object, tree: KeyTree, parents: string[], file: string): void {
  for (const [key, child] of Object.entries(value)) {
    if (!hasKey(tree, key)) throw unknownKey(key, tree, parents, file);
    const node = tree[key];
    if (node !== true && isPlainObject(child)) checkKeys(child, node, [...parents, key], file);
  }
}

/**
 * Builds the error for `key`, unknown under `parents`, suggesting the nearest sibling in `tree`.
 */
function unknownKey(key: string, tree: KeyTree, parents: string[], file: string): Error {
  const dotted = [...parents, key].join('.');
  const near = didYouMean(key, Object.keys(tree));
  const body = [
    parents.length === 0
      ? `No stacked layer declares \`${dotted}\`.`
      : `\`${parents.join('.')}\` has no key \`${key}\`.`,
  ];
  if (!isUndefined(near)) body.push('', `Did you mean \`${[...parents, near].join('.')}\`?`);
  else if (parents.length === 0) body.push('', 'If a layer adds it, list the layer in `layers`.');
  return ohneError({
    title: `Unknown config key \`${dotted}\``,
    body,
    path: file,
  });
}
