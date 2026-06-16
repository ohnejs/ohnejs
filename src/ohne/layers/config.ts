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
   * Printer settings consumed by `usePrinter`.
   * The `SILENT` and `DEBUG` env vars take precedence when set, regardless of value;
   * these fields only apply when the matching env var is unset.
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
