/**
 * Typed ohne env vars.
 * Add fields by augmenting it from a layer with `declare module 'ohne'`.
 *
 * Built-ins:
 * - `PORT` - overrides `Config.server.port` when set.
 * - `HOST` - overrides `Config.server.host` when set.
 * - `COOKIE_SECRET` - signs cookies set with `setSignedCookie`; required to use signed cookies.
 * - `SILENT` - truthy disables every printer call.
 * - `DEBUG` - debug filter, resolved against the `ohne` namespace via `isDebugEnabled`.
 * - `NO_COLOR` - non-empty value disables ANSI colors per the `no-color.org` standard.
 * - `FORCE_COLOR` - forces ANSI on (or off) regardless of TTY detection.
 * - `SKIP_CODEGEN` - truthy skips codegen on startup, for when a parent process already ran it.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Env {
 *     FOO: number
 *   }
 * }
 * ```
 */
export interface Env {
  /**
   * Port override for the HTTP server, taking precedence over `Config.server.port`.
   *
   * @default
   * undefined
   */
  PORT: number | undefined;

  /**
   * Host override for the HTTP server, taking precedence over `Config.server.host`.
   *
   * @default
   * undefined
   */
  HOST: string | undefined;

  /**
   * Secret that signs cookies set with `setSignedCookie` and verifies them on the way back in.
   * Has no usable default; signed cookies throw until it is set to a long, random value.
   *
   * @default
   * undefined
   */
  COOKIE_SECRET: string | undefined;

  /**
   * When `true`, every printer call is dropped.
   *
   * @default
   * false
   */
  SILENT: boolean;

  /**
   * Whether the `ohne` namespace is enabled by the current `DEBUG` filter.
   * Resolved through `isDebugEnabled('ohne', process.env.DEBUG)`.
   *
   * @default
   * false
   */
  DEBUG: boolean;

  /**
   * Whether `NO_COLOR` is set to any non-empty value.
   * Follows the `no-color.org` standard: presence disables color.
   *
   * @default
   * false
   */
  NO_COLOR: boolean;

  /**
   * Explicit color override.
   * `true` forces ANSI on; `false` forces it off; `undefined` defers to TTY auto-detection.
   *
   * @default
   * undefined
   */
  FORCE_COLOR: boolean | undefined;

  /**
   * When `true`, startup skips codegen.
   *
   * @default
   * false
   */
  SKIP_CODEGEN: boolean;
}
