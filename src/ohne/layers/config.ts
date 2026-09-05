import type {
  DeepPrettify,
  DefaultsMarker,
  LayerStrategies,
  LiteralUnion,
  RequireByShape,
} from '../../utils/index.ts';
import type { KnownBlocks } from '../blocks/known-blocks.ts';
import type { KnownCollections } from '../collections/known-collections.ts';
import type { LocaleCode } from '../collections/known-locales.ts';
import type { DashboardMenuEntry } from '../dashboard/menu.ts';
import type { DialectName } from '../database/known-dialects.ts';
import type { KnownFields } from '../fields/known-fields.ts';
import type { KnownLanguage } from '../messages/known-languages.ts';
import type { Message } from '../messages/known-messages.ts';
import type { QueryGuards } from '../query/wire/guards.ts';
import type { KnownRoles } from '../roles/known-roles.ts';
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
   * A name outside `LayerName` is accepted too, so a fresh layer can be listed before codegen sees it.
   *
   * Listed furthest-first: a later entry overrides an earlier one, and this project overrides all.
   * Resolution cascades - each listed layer's own `layers` load before it.
   * A layer shared by several entries loads once, ahead of every entry that lists it.
   *
   * @default
   * []
   */
  layers?: LiteralUnion<LayerName>[];

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
     * A `_`-prefixed file is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'boot'
     */
    boot?: string;

    /**
     * Directory each layer's middleware is read from.
     * Each `.ts` file is one middleware, named by its path (`foo/bar.ts` -> `foo-bar`).
     * Files under `global/` run on every request; the rest are opt-in per route via `defineHandler`.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'middleware'
     */
    middleware?: string;

    /**
     * Directory each layer's messages are read from.
     * Each `.json` file is named after a BCP-47 language tag (`en.json`, `de-AT.json`).
     * A subdirectory prefixes its keys, so `dashboard/en.json` contributes `dashboard.*` keys.
     * A `_`-prefixed file or directory is skipped, so a draft catalog can sit beside the live ones.
     * Resolved against each layer's root.
     *
     * @default
     * 'messages'
     */
    messages?: string;

    /**
     * Directory each layer's collections are read from.
     * Each `.ts` file default-exports one `defineCollection` result; the file names the collection.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'collections'
     */
    collections?: string;

    /**
     * Directory each layer's field types are read from.
     * Each `.ts` file default-exports one `defineField` result; the file names the field type.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'fields'
     */
    fields?: string;

    /**
     * Directory each layer's blocks are read from.
     * Each `.ts` file default-exports one `defineBlock` result; the file names the block.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'blocks'
     */
    blocks?: string;

    /**
     * Directory each layer's roles are read from.
     * Each `.ts` file default-exports one `defineRole` result; the file names the role in kebab-case.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'roles'
     */
    roles?: string;

    /**
     * Directory each layer's database migrations are read from.
     * Each `.ts` file default-exports one `defineMigration` result; files run in name order.
     * A `_`-prefixed file or directory is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'migrations'
     */
    migrations?: string;

    /**
     * Directory each layer's dashboard pages and components are read from and served from.
     * Dashboard pages live under `pages/` within it (`pages/authors/[id].ts` -> the `/authors/[id]` page).
     * Resolved against each layer's root.
     *
     * @default
     * 'dashboard'
     */
    dashboard?: string;
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
     *     '/internal/**',       // every route nested under /internal/
     *     'GET /admin/**',      // only GET, nested under /admin/
     *     'POST /authors/[id]', // a single method on one route
     *   ],
     * }
     * ```
     */
    routes?: string[];

    /**
     * Message keys to drop, as globs over the dot-separated key.
     * `*` matches within one segment and `**` across them, so `dashboard.**` drops the whole group.
     * A dropped key vanishes from the catalog endpoint, `useT`, and the generated `KnownMessages` type.
     *
     * @default
     * []
     *
     * @example
     * ```ts
     * disable: {
     *   messages: [
     *     'dashboard.**',  // every key in the dashboard group
     *     'field.email.*', // the direct keys under field.email
     *     'legal.cookies', // a single key
     *   ],
     * }
     * ```
     */
    messages?: string[];

    /**
     * Collection names to drop, matched exactly.
     * A dropped collection vanishes from registration, the desired schema, and the generated types.
     *
     * @default
     * []
     */
    collections?: LiteralUnion<Extract<keyof KnownCollections, string>>[];

    /**
     * Field-type names to drop, matched exactly.
     * Built-ins can be dropped too; a field still referencing a dropped type fails at codegen.
     *
     * @default
     * []
     */
    fields?: LiteralUnion<Extract<keyof KnownFields, string>>[];

    /**
     * Block names to drop, matched exactly.
     * A dropped block vanishes from registration, the desired schema, and the generated types.
     * A `blocks` field still allowing a dropped block fails at codegen.
     *
     * @default
     * []
     */
    blocks?: LiteralUnion<Extract<keyof KnownBlocks, string>>[];

    /**
     * Role names to drop, matched exactly.
     * A dropped role vanishes from registration and the generated `KnownRoles` type.
     *
     * @default
     * []
     */
    roles?: LiteralUnion<Extract<keyof KnownRoles, string>>[];
  };

  /**
   * Collection content settings.
   */
  collections?: {
    /**
     * The content locales records may hold, as BCP-47 tags.
     * Canonicalized before use; an invalid tag or a duplicate is an error.
     * The write layer enforces the set; sync never reads it.
     * Content locales are not UI languages, so the set is independent of the message catalogs.
     *
     * @default
     * ['en']
     *
     * @example
     * ```ts
     * collections: {
     *   locales: ['en', 'de-AT', 'fr'],
     *   defaultLocale: 'en',
     * }
     * ```
     */
    locales?: string[];

    /**
     * The locale existing values land on when a field turns translatable.
     * Must be one of `locales`; it never falls back to the set's first entry.
     * The one locale the schema engine consumes.
     * Inherited across layers, so a base layer can set the content dimension once.
     *
     * @default
     * 'en'
     */
    defaultLocale?: LocaleCode;
  };

  /**
   * Message catalog settings.
   */
  messages?: {
    /**
     * Language to fall back to when a request's language, and its parents, have no entry.
     * A BCP-47 tag like `en` or `de-AT`, canonicalized before use.
     * Once codegen has run it must be one of the catalog languages, typed by `KnownLanguages`.
     * Inherited across layers, so an upper layer can set it once for everything above.
     *
     * @default
     * 'en'
     */
    defaultLanguage?: KnownLanguage;
  };

  /**
   * Settings for the API's HTTP server, consumed by `serveAPI`.
   */
  api?: {
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
     * Base path every API route is mounted under.
     * A request outside the prefix is a `404`; inside it, the prefix is stripped before routing.
     * So `'/api'` serves a `/authors` route at `/api/authors`, and the handler still sees `/authors`.
     * Slashes are forgiving: `'/api'`, `'api/'`, and `'/api/'` all mean the same mount.
     * Empty mounts at the root, with no prefix.
     * Inherited across layers, so a base layer can mount a whole stack under one prefix.
     *
     * @default
     * ''
     */
    basePath?: string;

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
     * `false` keeps Node's own default of 60 seconds.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 10000 // 10 seconds, as raw milliseconds
     * '10s' // 10 seconds
     * false // keep Node's default of 60s
     * ```
     */
    headersTimeout?: number | string | false;

    /**
     * How long the server allows for the entire request, headers and body.
     * `false` keeps Node's own default of 5 minutes.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 30000 // 30 seconds, as raw milliseconds
     * '30s' // 30 seconds
     * false // keep Node's default of 5m
     * ```
     */
    requestTimeout?: number | string | false;

    /**
     * How long an idle keep-alive socket is held open between requests.
     * `false` keeps Node's own default of 5 seconds.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 5000  // 5 seconds, as raw milliseconds
     * '5s'  // 5 seconds
     * false // keep Node's default of 5s
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
     * Largest total request header block to accept, as a `parseBytes` value.
     * Caps the request line and all headers; the parser refuses anything larger before routing.
     * `false` keeps Node's own default of 16 KiB.
     *
     * @default
     * false
     *
     * @example
     * ```ts
     * 32768  // 32 KiB, as raw bytes
     * '32kb' // 32 KiB
     * false  // Node's 16 KiB default
     * ```
     */
    maxHeaderSize?: number | string | false;

    /**
     * Largest request body to accept, as a `parseBytes` value (bytes as a number, or a string like `'1mb'`).
     * An over-cap `Content-Length` is refused with `413` after the middleware, before the handler.
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
   * Settings for the dashboard's HTTP server, consumed by `serveDashboard`.
   */
  dashboard?: {
    /**
     * Port the dashboard server listens on.
     * The `PORT` env var overrides it when set.
     *
     * @default
     * 9000
     */
    port?: number;

    /**
     * Host the dashboard server binds to.
     * The `HOST` env var overrides it when set.
     * Absent binds every interface.
     */
    host?: string;

    /**
     * Absolute base URL of the API the browser reaches, including any `api.basePath`.
     * Injected into the dashboard shell so the client knows where to send requests.
     * The `API_URL` env var overrides it; omitted, it is derived from `Config.api`.
     * Set it when the API is reached at a different origin, such as behind a reverse proxy.
     */
    apiURL?: string;

    /**
     * Absolute origin the browser reaches the dashboard at, such as `https://admin.example.com`.
     * The API's `cors` middleware allows it for credentialed requests, so the session cookie flows.
     * The `DASHBOARD_URL` env var overrides it; omitted, it is derived from `dashboard.port`.
     * Set it when the dashboard is reached at a different origin, such as behind a reverse proxy.
     */
    origin?: string;

    /**
     * Menu groups for the dashboard sidebar, in order.
     * Each group holds collection names and page links; a group left with no row drops.
     * A collection the viewer cannot reach drops from its group.
     * Accessible collections in no group land in a trailing unlabeled group.
     * Omitted, the menu lists every accessible collection in one unlabeled group.
     *
     * @example
     * ```ts
     * menu: [
     *   { label: 'menu.content', items: ['Pages', 'Posts'] },
     *   {
     *     label: 'Shop',
     *     items: ['Orders', { to: '/sales', label: 'Sales', icon: 'coin' }],
     *   },
     *   { items: ['Users'] },
     * ]
     * ```
     */
    menu?: {
      /**
       * The group's heading, shown above its rows.
       * Pass a message key to translate it per the viewer's language.
       * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
       * Omitted renders the group without a heading.
       *
       * @example
       * ```ts
       * label: 'menu.content'                         // a message key, translated
       * label: { key: 'menu.shop', params: { n: 2 } } // a parameterized message
       * ```
       */
      label?: Message;

      /**
       * The rows the group holds, in order.
       * A collection name renders that collection's list link; a link object opens any dashboard page.
       */
      items: DashboardMenuEntry[];
    }[];
  };

  /**
   * Database connection and schema-sync settings.
   */
  database?: {
    /**
     * Which database dialect to use, by name.
     * ohne ships `sqlite`; other dialects are added by layers.
     *
     * @default
     * 'sqlite'
     */
    dialect?: DialectName;

    /**
     * Where the main database lives, as a URL the dialect understands.
     * For SQLite this is a file path, created on demand, or `:memory:` for an ephemeral database.
     * The `DATABASE` or `DB` env var overrides it when set.
     *
     * @default
     * '.data/ohne.db'
     */
    url?: string;

    /**
     * Additional databases keyed by name, each a URL the dialect understands.
     * Reach one with `useDatabase('name')`; a helper holds no schema, only what you read and write.
     * Any layer can contribute a helper; if two layers name the same one, the closer layer wins.
     *
     * @default
     * {}
     *
     * @example
     * ```ts
     * database: {
     *   helpers: { rateLimit: ':memory:' },
     * }
     * ```
     */
    helpers?: Record<string, string>;

    /**
     * Schema-sync settings.
     */
    sync?: {
      /**
       * Authorize a destructive sync, carrying out the data loss it would otherwise refuse.
       * The `FORCE_SYNC` env var overrides this for a single boot.
       *
       * @default
       * false
       */
      force?: boolean;
    };
  };

  /**
   * Query settings.
   */
  query?: {
    /**
     * DoS ceilings for wire-driven queries, overriding the framework defaults per key.
     * They gate the untrusted URL and POST-body paths; the fluent builder is trusted and never checked.
     * A closer layer or the app overrides a ceiling by naming it; unnamed ceilings keep the default.
     *
     * @example
     * ```ts
     * query: {
     *   limits: { maxInLength: 500, maxPerPage: 100 },
     * }
     * ```
     */
    guards?: Partial<QueryGuards>;
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
 * `api.port` and `api.host` are absent for the same reason: both are `'own'` (layer-private).
 * `dashboard.port` and `dashboard.host` are absent for the same reason.
 * A merged default never applies to an `'own'` key.
 *
 * ---
 *
 * `port` falls back to `DEFAULT_API_PORT`, read at point of use; `dashboard.port` to `DEFAULT_DASHBOARD_PORT`.
 */
export const DEFAULTS = {
  layers: [],
  disable: { routes: [], messages: [], collections: [], fields: [], blocks: [], roles: [] },
  collections: { locales: ['en'], defaultLocale: 'en' },
  messages: { defaultLanguage: 'en' },
  api: {
    basePath: '',
    preStopDelay: false,
    shutdownTimeout: false,
    deadline: false,
    headersTimeout: false,
    requestTimeout: false,
    keepAliveTimeout: false,
    maxConnections: false,
    maxHeaderSize: false,
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
  messages: 'messages',
  collections: 'collections',
  fields: 'fields',
  blocks: 'blocks',
  roles: 'roles',
  migrations: 'migrations',
  dashboard: 'dashboard',
} satisfies NonNullable<Config['dirs']>;

/**
 * Default port `serveAPI` listens on when no layer sets `api.port` and `PORT` is unset.
 * Read at point of use, like `DIR_DEFAULTS`, because `api.port` is `'own'` (layer-private).
 */
export const DEFAULT_API_PORT = 9001;

/**
 * Default port `serveDashboard` listens on when no layer sets `dashboard.port`.
 * Read at point of use, like `DEFAULT_API_PORT`, because `dashboard.port` is `'own'` (layer-private).
 */
export const DEFAULT_DASHBOARD_PORT = 9000;

/**
 * Default dialect selected when no layer sets `database.dialect`.
 * Read at point of use in `connect`, like `DEFAULT_API_PORT`, because `database.dialect` is `'own'`.
 */
export const DEFAULT_DIALECT = 'sqlite';

/**
 * Default main-database URL when no layer sets `database.url` and neither `DATABASE` nor `DB` is set.
 * Read at point of use in `connect`, like `DEFAULT_API_PORT`, because `database.url` is `'own'`.
 * A relative SQLite file path, created on demand.
 */
export const DEFAULT_DATABASE_URL = '.data/ohne.db';

/**
 * Framework merge strategies, seeded into the layer registry.
 *
 * - `dirs` stays each layer's own: it never inherits across the merge, matching how it is read.
 * - `disable.routes` accumulates across layers and dedupes, so every layer can add routes to drop.
 * - `disable.messages` accumulates across layers and dedupes, so every layer can add keys to drop.
 * - `disable.collections`, `disable.fields`, `disable.blocks`, and `disable.roles` accumulate and dedupe too.
 * - `printer` stays each layer's own: a dependency cannot silence or debug an app that consumes it.
 * - `api.port` and `api.host` stay each layer's own: both are private to the layer that sets them.
 * - `dashboard.port`, `dashboard.host`, and `dashboard.apiURL` stay each layer's own, like `api`'s.
 * - `dashboard.origin` and `dashboard.menu` stay each layer's own too.
 * - `database.dialect` and `database.url` stay each layer's own: an app owns its connection, like `api`'s.
 * - `database.sync.force` stays each layer's own: a dependency cannot force a destructive sync on an app.
 * - `database.helpers` is unlisted on purpose: the default per-key merge already lets any layer add one.
 */
export const BASE_STRATEGIES: LayerStrategies = {
  dirs: 'own',
  'disable.routes': 'concat-unique',
  'disable.messages': 'concat-unique',
  'disable.collections': 'concat-unique',
  'disable.fields': 'concat-unique',
  'disable.blocks': 'concat-unique',
  'disable.roles': 'concat-unique',
  printer: 'own',
  'api.port': 'own',
  'api.host': 'own',
  'dashboard.port': 'own',
  'dashboard.host': 'own',
  'dashboard.apiURL': 'own',
  'dashboard.origin': 'own',
  'dashboard.menu': 'own',
  'database.dialect': 'own',
  'database.url': 'own',
  'database.sync.force': 'own',
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
