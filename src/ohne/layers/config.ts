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

    /**
     * Directory each layer's boot files are read from.
     * Top-level `.ts` files run once at start in name order; an `index.ts` runs alone.
     * Resolved against each layer's root.
     *
     * @default
     * 'boot'
     */
    boot?: string;

    /**
     * Directory each layer's middleware is read from.
     * Each `.ts` file is one middleware, named by its path (`foo/bar.ts` -> `foo-bar`); all run globally.
     * Resolved against each layer's root.
     *
     * @default
     * 'middleware'
     */
    middleware?: string;
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
   * HTTP server settings consumed by `serveAPI`.
   * Every timeout accepts a `parseDuration` value: milliseconds as a number, or a string like `'10s'`.
   * `false` disables the corresponding limit.
   */
  server?: {
    /**
     * Port the server listens on.
     * The `PORT` env var overrides it when set.
     *
     * @default
     * 9001
     */
    port?: number;

    /**
     * Host the server binds to.
     * The `HOST` env var overrides it when set.
     * Absent binds every interface.
     */
    host?: string;

    /**
     * How long to keep serving after a shutdown signal before refusing connections.
     * Buys a load balancer time to deregister this instance first.
     * `false` refuses connections at once.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 5000  // 5 seconds, as raw milliseconds
     * '5s'  // 5 seconds
     * false // refuse connections at once
     * ```
     */
    preStopDelay?: number | string | false;

    /**
     * How long to wait for in-flight requests and their background work to drain.
     * Keep it below the deploy target's kill window (or raise that window), or it `SIGKILL`s mid-drain.
     * The window is the target's, so no default fits all: PM2 `kill_timeout` `1600ms`, k8s grace `30s`.
     * `false` waits indefinitely.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 10000 // 10 seconds, as raw milliseconds
     * '10s' // 10 seconds
     * false // wait indefinitely
     * ```
     */
    shutdownTimeout?: number | string | false;

    /**
     * Global deadline for every shutdown hook combined, passed to `useShutdown().watch`.
     * `false` waits for the hooks indefinitely.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 30000 // 30 seconds, as raw milliseconds
     * '30s' // 30 seconds
     * false // wait indefinitely
     * ```
     */
    deadline?: number | string | false;

    /**
     * How long the server waits for the complete request headers.
     * `false` keeps Node's own default.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 10000 // 10 seconds, as raw milliseconds
     * '10s' // 10 seconds
     * false // keep Node's default
     * ```
     */
    headersTimeout?: number | string | false;

    /**
     * How long the server allows for the entire request, headers and body.
     * `false` keeps Node's own default.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 30000 // 30 seconds, as raw milliseconds
     * '30s' // 30 seconds
     * false // keep Node's default
     * ```
     */
    requestTimeout?: number | string | false;

    /**
     * How long an idle keep-alive socket is held open between requests.
     * `false` keeps Node's own default.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 5000  // 5 seconds, as raw milliseconds
     * '5s'  // 5 seconds
     * false // keep Node's default
     * ```
     */
    keepAliveTimeout?: number | string | false;

    /**
     * Maximum number of concurrent sockets the server accepts.
     * `false` leaves the count unbounded, Node's own default.
     *
     * @default
     * false
     */
    maxConnections?: number | false;

    /**
     * Largest request body to accept, as a `parseBytes` value (bytes as a number, or a string like `'1mb'`).
     * An over-cap `Content-Length` is refused with `413` before any body is read.
     * A body that overruns mid-stream aborts with the same `413`.
     * `false` leaves the body size unbounded.
     *
     * @default
     * '1mb'
     *
     * @example
     * ```ts
     * 1048576 // one mebibyte, as raw bytes
     * '1mb'   // one mebibyte
     * false   // unbounded
     * ```
     */
    maxBodySize?: number | string | false;

    /**
     * How long middleware and the handler may run before the request is answered with `503`.
     * A `parseDuration` value, distinct from `requestTimeout`, which bounds the socket, not the work.
     * `false` lets the handler run without a deadline.
     *
     * @default
     * '30s'
     *
     * @example
     * ```ts
     * 30000 // 30 seconds, as raw milliseconds
     * '30s' // 30 seconds
     * false // no deadline
     * ```
     */
    handlerTimeout?: number | string | false;

    /**
     * How long a `waitUntil` promise may run after the response before it is abandoned.
     * A `parseDuration` value; on overrun the promise is logged and the request's drain ticket released.
     * Distinct from `shutdownTimeout`, which bounds background work only while shutting down.
     * `false` lets background work run without a deadline.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 60000 // 60 seconds, as raw milliseconds
     * '60s' // 60 seconds
     * false // no deadline
     * ```
     */
    waitUntilTimeout?: number | string | false;

    /**
     * CIDR ranges of proxies allowed to set `X-Forwarded-*`.
     * When the immediate peer is in one of these ranges, `X-Forwarded-Proto`/`X-Forwarded-Host` are honored.
     * They override the socket's own scheme and host, so `event.url` reflects the original client request.
     * An empty list trusts no proxy, so forwarding headers are ignored and the socket is the only truth.
     *
     * @default
     * []
     *
     * @example
     * ```ts
     * ['10.0.0.0/8']       // a private network of proxies
     * ['127.0.0.1', '::1'] // a local reverse proxy
     * ```
     */
    trustProxy?: string[];

    /**
     * Hostnames this server answers to, matched against the request's `Host` (the port is ignored).
     * A `Host` outside the list is refused with `400` before routing.
     * Each entry is a `compileGlob` pattern, so `'*.example.com'` matches any subdomain.
     * An empty list answers to any host.
     *
     * @default
     * []
     *
     * @example
     * ```ts
     * ['example.com', '*.example.com'] // the apex and its subdomains
     * ['localhost', '127.0.0.1']       // local development
     * ```
     */
    allowedHosts?: string[];
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
 * ---
 *
 * `dirs` is absent: a codegen or api directory is a per-layer preference, never inherited.
 * Its defaults live in `DIR_DEFAULTS`, read from each layer's own config.
 *
 * ---
 *
 * `printer` is absent too: `usePrinter` reads it before layers load and supplies its own fallback.
 *
 * ---
 *
 * `server.port` and `server.host` are absent for the same reason: both are `'own'` (layer-private).
 * A merged default never applies to an `'own'` key.
 *
 * ---
 *
 * `port` falls back to `DEFAULT_PORT`, read at point of use.
 */
export const DEFAULTS = {
  layers: [],
  disable: { routes: [] },
  server: {
    preStopDelay: false,
    shutdownTimeout: false,
    deadline: false,
    headersTimeout: false,
    requestTimeout: false,
    keepAliveTimeout: false,
    maxConnections: false,
    maxBodySize: '1mb',
    handlerTimeout: '30s',
    waitUntilTimeout: false,
    trustProxy: [],
    allowedHosts: [],
  },
} satisfies Config;

/**
 * Default per-layer directories.
 * Read from each layer's own config with this as the fallback, never through the cross-layer merge.
 */
export const DIR_DEFAULTS = {
  codegen: '.ohne',
  api: 'api',
  boot: 'boot',
  middleware: 'middleware',
} satisfies NonNullable<Config['dirs']>;

/**
 * Default port `serveAPI` listens on when no layer sets `server.port` and `PORT` is unset.
 * Read at point of use, like `DIR_DEFAULTS`, because `server.port` is `'own'` (layer-private).
 */
export const DEFAULT_PORT = 9001;

/**
 * Framework merge strategies, seeded into the layer registry.
 *
 * - `dirs` stays each layer's own: it never inherits across the merge, matching how it is read.
 * - `disable.routes` accumulates across layers and dedupes, so every layer can add routes to drop.
 * - `printer` stays each layer's own: a dependency cannot silence or debug an app that consumes it.
 * - `server.port` and `server.host` stay each layer's own: both are private to the layer that sets them.
 */
export const BASE_STRATEGIES: LayerStrategies = {
  dirs: 'own',
  'disable.routes': 'concat-unique',
  printer: 'own',
  'server.port': 'own',
  'server.host': 'own',
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

/**
 * Maps a disableable setting's `false` "off" value to `undefined`.
 * Config uses `false` to disable a limit, so a closer layer can override an inherited one.
 * APIs that take the value read `undefined` as "off", so convert it at that boundary.
 *
 * @example
 * ```ts
 * offToUndefined('10s') // -> '10s'
 * offToUndefined(false) // -> undefined
 * ```
 */
export function offToUndefined<T>(value: T | false): T | undefined {
  return value === false ? undefined : value;
}
