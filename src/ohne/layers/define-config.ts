import type { Config } from './config.ts';

/**
 * Defines your project's config, with type checking and editor autocomplete.
 * The default export of the `ohne.config.ts` at your project root.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   layers: ['ohne', '@acme/base'],
 *   dirs: { api: 'routes' },
 * })
 * ```
 */
export function defineConfig(config: Config): Config {
  return config;
}
