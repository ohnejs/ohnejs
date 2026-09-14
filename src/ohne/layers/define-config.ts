import type { Config } from './config.ts';

/**
 * Defines your project's config, with type checking and editor autocomplete.
 * The default export of the `ohne.config.ts` at your project root.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   layers: ['ohnejs', '@acme/base'],
 *   database: { url: '.data/app.db' },
 *   api: { port: 3000 },
 * })
 * ```
 */
export function defineConfig(config: Config): Config {
  return config;
}
