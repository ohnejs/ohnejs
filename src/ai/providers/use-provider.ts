import type { Env } from 'ohnejs';

import { ohneError, useEnv } from 'ohnejs';
import { hasKey, isEmpty, isUndefined } from 'ohnejs/utils';

import type { AIModel, AIProvider } from '../config.ts';
import type { Provider, ProviderOptions } from './provider.ts';

import { useAIConfig } from '../config.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import { createOpenAIProvider } from './openai.ts';

const FACTORIES: Record<Exclude<AIProvider, 'jev'>, (options: ProviderOptions) => Provider> = {
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  'openai-compatible': createOpenAICompatibleProvider,
};

/**
 * Whether the `ai.models` entry `name` can be called now: its `key` is `false`, or its env var holds a value.
 *
 * @example
 * ```ts
 * hasModelKey('smart') // -> false while `ANTHROPIC_API_KEY` is unset
 * ```
 */
export function hasModelKey(name: string): boolean {
  const entry = modelEntry(name);
  return !isUndefined(entry) && (entry.key === false || !isUndefined(readKey(entry.key)));
}

/**
 * Builds the provider for the `ai.models` entry `name`, reading its key from the env at this call.
 * A key set or rotated while the server runs takes effect on the next call.
 * It throws for a name `ai.models` lacks, for a `jev` entry, and for a key whose env var is unset.
 *
 * @example
 * ```ts
 * const provider = useProvider('smart')
 * for await (const event of provider.step(request, signal)) send(event)
 * ```
 */
export function useProvider(name: string): Provider {
  const { entry, options } = modelOptions(name);
  if (entry.provider === 'jev') {
    throw ohneError(`The \`jev\` model \`${name}\` answers flow decisions only`);
  }
  return FACTORIES[entry.provider](options);
}

/**
 * The `ai.models` entry `name` and what its provider is built from, the key read from the env at this call.
 * It throws for a name `ai.models` lacks, and for a key whose env var is unset.
 *
 * @example
 * ```ts
 * modelOptions('router').entry.provider // -> 'jev'
 * ```
 */
export function modelOptions(name: string): { entry: AIModel; options: ProviderOptions } {
  const entry = modelEntry(name);
  if (isUndefined(entry)) throw ohneError(`Unknown model \`${name}\``);
  const key = entry.key === false ? undefined : readKey(entry.key);
  if (entry.key !== false && isUndefined(key)) {
    throw ohneError({
      title: `The \`${name}\` model has no key`,
      body: [`Set \`${entry.key}\` to its API key, in the environment or in \`.env\`.`],
    });
  }
  const { model, baseURL, headers, options } = entry;
  return { entry, options: { model, key, baseURL, headers, options } };
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
