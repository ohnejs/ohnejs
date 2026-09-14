import type { LayerStrategies } from '../../utils/index.ts';
import type { CodegenBucket } from '../codegen/codegen-dir.ts';
import type { Config } from './config.ts';

export type { LayerStrategies } from '../../utils/index.ts';
export type { CodegenBucket } from '../codegen/codegen-dir.ts';

/**
 * A file a layer generates into the consuming app's codegen directory.
 * `code` runs once the layer stack has loaded, so it can read the merged config through `useConfig`.
 * The file gets the ohne banner and is pruned like every other generated file.
 */
export interface LayerCodegen {
  /**
   * The bucket the file lands in, which decides the TypeScript program that includes it.
   * `'node'` for `ohnejs` augmentations, `'browser'` for `ohnejs/dashboard` ones, `'shared'` for pure types.
   */
  bucket: CodegenBucket;

  /**
   * The file name inside the bucket, a plain `.ts` name such as `image-variants.ts`.
   * No two entries in the stack may claim the same bucket and name.
   */
  file: string;

  /**
   * Returns the file's content, without the banner.
   */
  code(): string | Promise<string>;
}

/**
 * What a layer contributes beyond its content.
 * `defaults` and `strategies` target the keys the layer declares.
 * Its own values still live in `ohne.config.ts`.
 * `codegen` lists the files it generates into the consuming app's codegen directory.
 */
export interface LayerDefinition {
  /**
   * Default values for the keys this layer introduces.
   * Floors the stack: filled wherever no project sets the key, never overriding one that does.
   *
   * @default
   * {}
   */
  defaults?: Config;

  /**
   * Merge strategies for the keys this layer introduces, keyed by dot-notation path.
   *
   * - `'replace'` - the closer layer wins entirely; a layer that omits the key still inherits it.
   * - `'own'` - the closer layer wins entirely and never inherits; an omitted key stays unset.
   * - `'defaults'` - recurse into objects per key and arrays per index; the longer side fills the rest.
   * - `'assign'` - objects merge one level: keys union, the closer layer's value replaces per key.
   *   Values are never recursed into; non-objects behave like `'replace'`.
   * - `'concat'` - arrays only: the closer layer's items first, then the lower layers'.
   * - `'concat-unique'` - same as `'concat'`, then duplicates are dropped.
   *
   * @default
   * {}
   *
   * @example
   * ```ts
   * strategies: {
   *   'myFeature.tags': 'concat-unique',
   * }
   * ```
   */
  strategies?: LayerStrategies;

  /**
   * Files this layer generates into the consuming app's codegen directory.
   * Each entry's `code` runs once the stack has loaded, so it can read the merged config.
   * Use it to type what only the resolved config knows, like the names an app configures.
   *
   * @default
   * []
   *
   * @example
   * ```ts
   * codegen: [
   *   {
   *     bucket: 'node',
   *     file: 'my-feature.ts',
   *     code: () => `export type Tag = ${literalUnion(useConfig().myFeature.tags)};\n`,
   *   },
   * ]
   * ```
   */
  codegen?: LayerCodegen[];
}

/**
 * Defines what a layer owns: `defaults` and `strategies` for the keys it introduces, and its `codegen`.
 * The default export of an optional `ohne.layer.ts`, present only when a layer adds keys or files.
 *
 * Declare the keys by augmenting `Config` first, then describe their defaults and merge below.
 * A layer's own values still belong in its `ohne.config.ts` via `defineConfig`.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface Config {
 *     myFeature: { ttl: number; tags: string[] }
 *   }
 * }
 *
 * export default defineLayer({
 *   defaults: { myFeature: { ttl: 3600, tags: [] } },
 *   strategies: { 'myFeature.tags': 'concat-unique' },
 * })
 * ```
 */
export function defineLayer(layer: LayerDefinition): LayerDefinition {
  return layer;
}
