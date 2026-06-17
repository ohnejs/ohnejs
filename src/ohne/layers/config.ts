import type { DeepPrettify, RequireByShape } from '../../utils/index.ts';

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
   * Configurable directories.
   * Relative paths resolve against the app root.
   */
  dirs?: {
    /**
     * Directory ohne writes generated `.ts` files to.
     *
     * @default
     * '.ohne'
     */
    codegen?: string;
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
 *         codegen: true;
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
