import type { NodeEnv } from '../../utils/env/index.ts';

/**
 * Typed ohne env vars.
 * Add fields by augmenting it from a layer with `declare module 'ohnejs'`.
 *
 * Built-ins:
 * - `NODE_ENV` - runtime environment; `production` or `test`, else `development`.
 * - `PORT` - overrides `Config.api.port` and `Config.dashboard.port` when set.
 * - `HOST` - overrides `Config.api.host` and `Config.dashboard.host` when set.
 * - `API_URL` - the dashboard's API base URL; overrides `Config.dashboard.apiURL` and the derived default.
 * - `DASHBOARD_URL` - the dashboard's origin; overrides `Config.dashboard.origin` and the derived default.
 * - `COOKIE_SECRET` - signs cookies set with `setSignedCookie`; required to use signed cookies.
 * - `SILENT` - truthy disables every printer call.
 * - `DEBUG` - debug filter, resolved against the `ohne` namespace via `isDebugEnabled`.
 * - `NO_COLOR` - non-empty value disables ANSI colors per the `no-color.org` standard.
 * - `FORCE_COLOR` - forces ANSI on (or off) regardless of TTY detection.
 * - `SKIP_CODEGEN` - truthy skips codegen on startup, for when a parent process already ran it.
 * - `DASHBOARD_RELOAD` - truthy makes the dashboard serve its dev reload stream and inject the client.
 * - `DATABASE` - overrides `Config.database.url`, the main database connection URL.
 * - `DB` - alias of `DATABASE`; setting both throws.
 * - `FORCE_SYNC` - truthy authorizes and performs a destructive schema sync for one boot.
 *
 * Each built-in is also a CLI flag - the kebab-case of its name, so `FORCE_SYNC` is `--force-sync`.
 * A booleanish var is a switch (`--force-sync` / `--no-force-sync`); the rest take a value (`--host x`).
 * The flag wins over the env var for that run.
 * Values come from the process environment, which the project's `.env` fills where the shell set nothing.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface Env {
 *     FOO: number
 *   }
 * }
 * ```
 */
export interface Env {
  /**
   * The runtime environment, read from `NODE_ENV`.
   * `production` and `test` match exactly; every other value, and unset, is `development`.
   *
   * @default
   * 'development'
   */
  NODE_ENV: NodeEnv;

  /**
   * Port override for the HTTP servers, taking precedence over `Config.api.port` and `Config.dashboard.port`.
   *
   * @default
   * undefined
   */
  PORT: number | undefined;

  /**
   * Host override for the HTTP servers, taking precedence over `Config.api.host` and `Config.dashboard.host`.
   *
   * @default
   * undefined
   */
  HOST: string | undefined;

  /**
   * Base URL of the API the dashboard's browser client calls, including any base path.
   * Takes precedence over `Config.dashboard.apiURL` and the URL derived from `Config.api`.
   *
   * @default
   * undefined
   */
  API_URL: string | undefined;

  /**
   * Origin the browser reaches the dashboard at, allowed by the API's `cors` middleware.
   * Takes precedence over `Config.dashboard.origin` and the URL derived from `Config.dashboard.port`.
   *
   * @default
   * undefined
   */
  DASHBOARD_URL: string | undefined;

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

  /**
   * When `true`, the dashboard serves its dev live-reload stream and injects the browser reload client.
   * `ohne dev` enables it by default, overridable with `DASHBOARD_RELOAD=0`.
   * A standalone `ohne serve dashboard` leaves it off.
   *
   * @default
   * false
   */
  DASHBOARD_RELOAD: boolean;

  /**
   * Connection URL for the main database, taking precedence over `Config.database.url`.
   * `DB` is an alias; setting both throws, since ohne cannot tell which you meant.
   *
   * @default
   * undefined
   */
  DATABASE: string | undefined;

  /**
   * Alias of `DATABASE`, taking precedence over `Config.database.url`.
   * Setting both `DATABASE` and `DB` throws, since ohne cannot tell which you meant.
   *
   * @default
   * undefined
   */
  DB: string | undefined;

  /**
   * When `true`, the schema sync authorizes and performs the destructive changes it would otherwise refuse.
   * Overrides `Config.database.sync.force` for a single boot.
   *
   * @default
   * false
   */
  FORCE_SYNC: boolean;
}
