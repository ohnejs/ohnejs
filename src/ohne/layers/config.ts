import type {
  DeepPrettify,
  DefaultsMarker,
  LayerStrategies,
  RequireByShape,
} from '../../utils/index.ts';
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
 *       myFeature: {
 *         enabled: true
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface ConfigExtensions {}

/**
 * Framework config defaults, applied beneath every layer.
 * Merged into the furthest layer's own defaults, so any layer or the app can override them.
 *
 * `dirs` is absent: a codegen or api directory is a per-layer preference, never inherited.
 * Its defaults live in `DIR_DEFAULTS`, read from each layer's own config.
 * `printer` is absent too: `usePrinter` reads it before layers load and supplies its own fallback.
 */
export const DEFAULTS = {
  layers: [],
  disable: { routes: [] },
} satisfies Config;

/**
 * Default per-layer directories.
 * Read from each layer's own config with this as the fallback, never through the cross-layer merge.
 */
export const DIR_DEFAULTS = {
  codegen: '.ohne',
  api: 'api',
} satisfies NonNullable<Config['dirs']>;

/**
 * Framework merge strategies, seeded into the layer registry.
 * `disable.routes` accumulates across layers and dedupes, so every layer can add routes to drop.
 */
export const BASE_STRATEGIES: LayerStrategies = {
  'disable.routes': 'concat-unique',
};

/**
 * The config returned by `useConfig`, after every layer is merged.
 * A defaulted field becomes required while keeping its declared type; the rest stay as in `Config`.
 *
 * Once config codegen runs, `ConfigExtensions` carries the full defaults tree, framework and layers alike.
 * Until then the framework `DEFAULTS` still apply, so their fields stay required.
 */
export type ResolvedConfig = ConfigExtensions extends { defaults: infer D }
  ? DeepPrettify<RequireByShape<Config, D>>
  : DeepPrettify<RequireByShape<Config, DefaultsMarker<typeof DEFAULTS>>>;
