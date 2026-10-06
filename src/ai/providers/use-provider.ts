import type { Env } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { applyHook, ohneError, tryUseEvent, useEnv } from 'ohnejs';
import { hasKey, isEmpty, isUndefined } from 'ohnejs/utils';

import type { AIModel, AIModelKey, AIProvider } from '../config.ts';
import type { Provider, ProviderOptions } from './provider.ts';

import { useAIConfig } from '../config.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import { createOpenAIProvider } from './openai.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters what the `ai.models` entry `name` is called with for one user, once per request.
     * The threaded value is `{ key }` from the entry's env var, or `{}` for `key: false`.
     * It is `false` while that env var is unset.
     * Return credentials, or `false` to make the entry unavailable to the user.
     */
    'ai:credentials': (
      resolved: AICredentials | false,
      context: { name: AIModelKey; entry: AIModel; user: User },
    ) => void | AICredentials | false | Promise<void | AICredentials | false>;

    /**
     * Filters the model a user's turn plans with when they pick none.
     * The threaded value is `ai.model` while the user can call it, else the empty string.
     * A name outside `available`, the entries the user can call, is ignored.
     */
    'ai:model': (
      model: AIModelKey,
      context: { user: User; available: AIModelKey[] },
    ) => void | AIModelKey | Promise<void | AIModelKey>;
  }
}

/**
 * How one `ai.models` entry is called for one user.
 * Each field replaces the entry's own value; `headers` are merged over the entry's.
 */
export interface AICredentials {
  /**
   * The API key, sent as the provider's credential header.
   */
  key?: string;

  /**
   * The API's origin, with the path prefix the provider's own SDK expects.
   */
  baseURL?: string;

  /**
   * Headers sent with every request, over the entry's own.
   */
  headers?: Record<string, string>;
}

const FACTORIES: Record<Exclude<AIProvider, 'jev'>, (options: ProviderOptions) => Provider> = {
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  'openai-compatible': createOpenAICompatibleProvider,
};

// A request asks for the same entry many times, and an `ai:credentials` hook may cost a lookup each time.
const resolved = new WeakMap<object, Map<string, Promise<AICredentials | false>>>();

/**
 * What the `ai.models` entry `name` is called with for `user`, or `false` when it cannot be called now.
 * Its env var is read at this call, then `ai:credentials` filters the result.
 * Within a request the answer is kept per user and entry, so every caller in it agrees.
 *
 * @example
 * ```ts
 * await modelCredentials('smart', user) // -> false while `ANTHROPIC_API_KEY` is unset
 * ```
 */
export function modelCredentials(name: string, user: User): Promise<AICredentials | false> {
  const event = tryUseEvent();
  if (isUndefined(event)) return resolveCredentials(name, user);
  let cache = resolved.get(event);
  if (isUndefined(cache)) resolved.set(event, (cache = new Map()));
  const id = `${user.UUID}\0${name}`;
  let pending = cache.get(id);
  if (isUndefined(pending)) cache.set(id, (pending = resolveCredentials(name, user)));
  return pending;
}

/**
 * Whether `user` can call the `ai.models` entry `name` now.
 *
 * @example
 * ```ts
 * await canUseModel('smart', user) // -> false while `ANTHROPIC_API_KEY` is unset
 * ```
 */
export async function canUseModel(name: string, user: User): Promise<boolean> {
  return (await modelCredentials(name, user)) !== false;
}

/**
 * The model `user`'s turn plans with when they pick none: `ai.model`, as `ai:model` filters it.
 * It is `undefined` when the assistant is off or no model the hook may pick can be called.
 *
 * @example
 * ```ts
 * await defaultModel(user) // -> 'smart'
 * ```
 */
export async function defaultModel(user: User): Promise<string | undefined> {
  const { model, models } = useAIConfig();
  if (isUndefined(model)) return undefined;
  const available: string[] = [];
  for (const name of Object.keys(models)) {
    if (models[name].provider !== 'jev' && (await canUseModel(name, user))) available.push(name);
  }
  const own = available.includes(model) ? model : undefined;
  const picked = await applyHook('ai:model', own ?? '', { user, available });
  return available.includes(picked) ? picked : own;
}

/**
 * Builds the provider for the `ai.models` entry `name` as `user` calls it.
 * A key set or rotated while the server runs takes effect on the next call.
 * It throws for a name `ai.models` lacks, for a `jev` entry, and for an entry `user` cannot call.
 *
 * @example
 * ```ts
 * const provider = await useProvider('smart', user)
 * for await (const event of provider.step(request, signal)) send(event)
 * ```
 */
export async function useProvider(name: string, user: User): Promise<Provider> {
  const { entry, options } = await modelOptions(name, user);
  if (entry.provider === 'jev') {
    throw ohneError(`The \`jev\` model \`${name}\` answers flow decisions only`);
  }
  return FACTORIES[entry.provider](options);
}

/**
 * The `ai.models` entry `name` and what its provider is built from as `user` calls it.
 * It throws for a name `ai.models` lacks, and for an entry `user` cannot call.
 *
 * @example
 * ```ts
 * (await modelOptions('router', user)).entry.provider // -> 'jev'
 * ```
 */
export async function modelOptions(
  name: string,
  user: User,
): Promise<{ entry: AIModel; options: ProviderOptions }> {
  const entry = modelEntry(name);
  if (isUndefined(entry)) throw ohneError(`Unknown model \`${name}\``);
  const credentials = await modelCredentials(name, user);
  if (credentials === false) {
    throw ohneError({
      title: `The \`${name}\` model cannot be called`,
      body:
        entry.key !== false && isUndefined(readKey(entry.key))
          ? [`Set \`${entry.key}\` to its API key, in the environment or in \`.env\`.`]
          : ['An `ai:credentials` hook made it unavailable to this user.'],
    });
  }
  const { model, options, maxOutput } = entry;
  const headers = isUndefined(credentials.headers)
    ? entry.headers
    : { ...entry.headers, ...credentials.headers };
  return {
    entry,
    options: {
      model,
      key: credentials.key,
      baseURL: credentials.baseURL ?? entry.baseURL,
      headers,
      options,
      maxOutput,
    },
  };
}

/**
 * The entry's own credentials from the env, as `ai:credentials` filters them for `user`.
 */
async function resolveCredentials(name: string, user: User): Promise<AICredentials | false> {
  const entry = modelEntry(name);
  if (isUndefined(entry)) return false;
  const key = entry.key === false ? undefined : readKey(entry.key);
  const own = entry.key === false ? {} : isUndefined(key) ? false : { key };
  return applyHook('ai:credentials', own, { name, entry, user });
}

/**
 * The `ai.models` entry `name`, never an inherited property of the map.
 */
function modelEntry(name: string): AIModel | undefined {
  const { models } = useAIConfig();
  return hasKey(models, name) ? models[name] : undefined;
}

/**
 * The value the env var `name` holds now, or `undefined` when it is unset or empty.
 */
function readKey(name: string): string | undefined {
  const key = useEnv().get(name as keyof Env) as string | undefined;
  return isUndefined(key) || isEmpty(key) ? undefined : key;
}
