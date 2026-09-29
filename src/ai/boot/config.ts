import type { Env } from 'ohnejs';

import { useEnv } from 'ohnejs';
import { isString } from 'ohnejs/utils';

import { useAIConfig, validateAIConfig } from '../config.ts';

validateAIConfig();
defineKeys();

/**
 * Defines the env var each model names as its `key`, unset by default, so a provider can read it.
 * A var another layer already defines keeps its own spec.
 */
function defineKeys(): void {
  const env = useEnv();
  for (const { key } of Object.values(useAIConfig().models)) {
    if (!isString(key) || env.names().includes(key as keyof Env)) continue;
    env.define(key as keyof Env, { default: undefined as never });
  }
}
