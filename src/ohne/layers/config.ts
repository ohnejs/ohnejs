import type { DeepPrettify, RequireByShape } from '../../utils/index.ts';
import type { LayerName } from './layer-name.ts';

/**
 * Typed ohne config.
 * Add fields by augmenting it from a layer with `declare module 'ohne'`.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Config {
 *     myFeature: { enabled: boolean }
 *   }
 * }
 * ```
 */
export interface Config {
  /**
   * Layers this project extends, by name.
   * Each name must be an ohne layer in the dependency closure; that closure types `LayerName`.
   * Add a layer to your `package.json` dependencies to make it referenceable, then list it here to stack it.
   *
   * Listed furthest-first: a later entry overrides an earlier one, and this project overrides all.
   * Resolution cascades - each listed layer's own `layers` load before it.
   * A layer shared by several entries loads once, ahead of every entry that lists it.
   *
   * @default
   * []
   */
  layers?: LayerName[];

  /**
   * Configurable directories.
   */
  dirs?: {
    /**
     * Directory ohne writes generated `.ts` files to.
     * Resolved against the app root.
     *
     * @default
     * '.ohne'
     */
    codegen?: string;

    /**
     * Directory each layer's API routes are read from.
     * Files map to routes by their path, with a `.{method}` suffix selecting the HTTP method.
     * Resolved against each layer's root.
     *
     * @default
     * 'api'
     */
    api?: string;
  };

  /**
   * Components to disable, grouped by kind.
   * Disabling happens after every layer is combined.
   */
  disable?: {
    /**
     * Route ids to drop, as globs.
     * A glob without a method prefix matches the route's pattern regardless of method.
     * A glob with one (e.g. `'GET /admin/**'`) matches only that method.
     *
     * @default
     * []
     *
     * @example
     * ```ts
     * disable: {
     *   routes: [
     *     '/internal/**',     // every route nested under /internal/
     *     'GET /admin/**',    // only GET, nested under /admin/
     *     'POST /users/[id]', // a single method on one route
     *   ],
     * }
     * ```
     */
    routes?: string[];
  };

  /**
   * Printer settings consumed by `usePrinter`.
   * The `SILENT` and `DEBUG` env vars take precedence when set, regardless of value.
   * These fields only apply when the matching env var is unset.
   */
  printer?: {
    /**
     * When `true`, every print call is dropped.
     *
     * @default
     * false
     */
    silent?: boolean;

    /**
     * When `true`, `Printer.debug` and `Printer.debugBlock` emit.
     *
     * @default
     * false
     */
    debug?: boolean;
  };
}

/**
 * Codegen extension point for the resolved config shape.
 * Empty until codegen runs.
 * The `resolved-config.ts` it emits adds a `defaults` tree marking every field a layer defaults.
 *
 * `type` aliases cannot be augmented, so the overridable shape lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface ConfigExtensions {
 *     defaults: {
 *       dirs: {
 *         codegen: true
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface ConfigExtensions {}

/**
 * The config returned by `useConfig`, after every layer is merged.
 * A field a layer defaults becomes required while keeping its declared type; the rest stay as in `Config`.
 * Falls back to `Config` until codegen has run.
 */
export type ResolvedConfig = ConfigExtensions extends { defaults: infer D }
  ? DeepPrettify<RequireByShape<Config, D>>
  : Config;
