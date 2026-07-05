/**
 * The names of the registered dialects.
 * ohne's built-in `sqlite` is always present; a dialect layer augments this with its own name.
 *
 * `type` aliases cannot be augmented, so the extra names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownDialects {
 *     postgres: true
 *   }
 * }
 * ```
 */
export interface KnownDialects {
  /**
   * ohne's built-in SQLite dialect, over `node:sqlite`.
   */
  sqlite: true;
}

/**
 * The name of a registered dialect, used by `Config.database.dialect`.
 * Always includes `sqlite`, plus any dialect a layer adds.
 */
export type DialectName = keyof KnownDialects;
