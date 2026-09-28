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
 * Add fields by augmenting it from a layer with `declare module 'ohnejs'`.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface Config {
 *     myFeature: { enabled: boolean }
 *   }
 * }
 * ```
 */
export interface Config {
  /**
   * Layers this project extends, by name.
   * Add a layer to your `package.json` dependencies to make it referenceable, then list it here to stack it.
   * Autocomplete suggests every installed layer; a name it does not know yet is accepted too.
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
     * Directory each layer's CLI commands are read from.
     * Each top-level `.ts` file default-exports one `defineCommand` result; the file names the command.
     * A `_`-prefixed file is a helper and is skipped.
     * Resolved against each layer's root.
     *
     * @default
     * 'commands'
     */
    commands?: string;

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
     * A dropped collection is treated everywhere as if no layer defined it, schema sync included.
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
     * A dropped block is treated everywhere as if no layer defined it, schema sync included.
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
     * Queries refuse a locale outside the set; changing the set never changes the database schema.
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
     * A query that names no locale reads and writes this one.
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
     * How long in-flight requests and their background work may take to drain.
     * When it expires, every request still in flight is cancelled, even one already answered.
     * Its connection closes and its `signal` aborts, so its handler or `waitUntil` work can stop.
     * Shutdown then waits for their cleanup, which only `deadline` bounds, so set `deadline` too.
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
     * Global deadline for every `onShutdown` hook combined, the server's own drain included.
     * It is the only hard stop, so it also bounds the cleanup of the requests `shutdownTimeout` cancelled.
     * When it passes, the process exits with code `1`.
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
     * Largest total request header block to accept, in bytes or as a string like `'32kb'`.
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
     * Largest request body to accept, in bytes or as a string like `'1mb'`.
     * An over-cap `Content-Length` is refused with `413` after the middleware, before the handler.
     * A body that overruns mid-stream aborts with the same `413`.
     * `false` leaves the body size unbounded.
     * A route overrides it for itself through `defineHandler`.
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
     * Distinct from `requestTimeout`, which bounds the socket, not the work.
     * The handler keeps running after the `503`, and shutdown waits for it.
     * `false` lets the handler run without a deadline.
     * A route overrides it for itself through `defineHandler`.
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
     * On overrun the promise is logged and shutdown stops waiting for it.
     * Distinct from `shutdownTimeout`, which bounds background work only while shutting down.
     * `false` lets background work run without a deadline.
     * A route overrides it for itself through `defineHandler`.
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
     * A trusted peer's `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` are honored.
     * `event.ip` and `event.url` then reflect the original client, not the proxy hop.
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
     * Each entry is a glob pattern, so `'*.example.com'` matches any subdomain.
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
     * It is also trusted to send cookie-authenticated writes.
     * The `DASHBOARD_URL` env var overrides it; omitted, it is derived from `dashboard.host` and `port`.
     * Set it when the dashboard is reached at a different origin, such as behind a reverse proxy.
     */
    origin?: string;

    /**
     * Menu groups for the dashboard sidebar, in order.
     * Each group holds collection names and page links; a group left with no row drops.
     * A collection the viewer cannot reach drops from its group.
     * Accessible collections in no group land in a trailing unlabeled group.
     * Omitted, the menu leads with the overview row, then lists every accessible collection unlabeled.
     * Declared, the menu shows the overview row only if you list a link to `/overview`.
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
       * A singleton's row opens its record instead of a list.
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
     *
     * @example
     * ```ts
     * query: {
     *   guards: { maxInLength: 500, maxPerPage: 100 },
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
 * declare module 'ohnejs' {
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
 * Every `'own'` key in `BASE_STRATEGIES` is absent, since a merged default never applies to one.
 * Their defaults apply at point of use, such as `DIR_DEFAULTS` and `DEFAULT_API_PORT`.
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
  commands: 'commands',
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
 * - Every `disable` list accumulates across layers and dedupes, so every layer can add components to drop.
 * - `printer` stays each layer's own: a dependency cannot silence or debug an app that consumes it.
 * - The listed `api` and `dashboard` keys stay each layer's own: an app owns its servers and sidebar.
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
