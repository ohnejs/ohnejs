# Configuration

`ohne.config.ts` at the root is what makes a directory an ohne project - the CLI, the servers, and
codegen all recognize the project by this one file. It default-exports a `defineConfig` call, which
adds type checking and autocomplete to a plain object:

```ts
// ohne.config.ts
import { defineConfig } from 'ohne';

export default defineConfig({
  layers: ['ohne'],
});
```

Every key is optional and every key has a default, so this scaffold config is already complete.
The defaults quoted below are what you get by leaving a key out.

## Layers

`layers` names the layers this project extends. A layer is an npm package that contributes routes,
collections, messages, and config of its own - ohne itself ships one, which is why the scaffold
lists it. Add the package to your `package.json` dependencies, then list it here to stack it.

Entries are listed furthest-first: a later entry overrides an earlier one, and your project
overrides all. Defaults to `[]`. See [layers](./layers.md).

## Directories

`dirs` sets where each kind of file is read from, resolved against the layer's own root:

- `codegen: '.ohne'` - where ohne writes generated `.ts` files, resolved against the app root.
- `api: 'api'` - API route files.
- `boot: 'boot'` - boot files, run once at start.
- `middleware: 'middleware'` - middleware; files under `global/` run on every request.
- `messages: 'messages'` - message catalogs, one JSON file per language.
- `collections: 'collections'` - collection definitions.
- `fields: 'fields'` - custom field types.
- `blocks: 'blocks'` - block definitions.
- `roles: 'roles'` - role definitions.
- `migrations: 'migrations'` - database migrations.
- `dashboard: 'dashboard'` - dashboard pages and components.

`dirs` is never inherited. Each layer's directories come from its own config: renaming your `api`
directory to `routes` moves your routes, not a dependency's, and a layer's choice never moves
yours.

## Disabling

`disable` drops components after every layer is combined - the tool for taking a layer but not all
of it:

```ts
disable: {
  routes: ['GET /admin/**'],
  messages: ['dashboard.**'],
  collections: ['Drafts'],
},
```

- `routes` - globs over route ids. Without a method prefix a glob matches every method; with one
  (`'GET /admin/**'`) only that method.
- `messages` - globs over the dot-separated key, so `dashboard.**` drops the whole group. A dropped
  key vanishes from the catalog endpoint, `useT`, and the generated `KnownMessages` type.
- `collections`, `fields`, `blocks`, `roles` - exact names. A dropped collection or block vanishes
  from the schema and the generated types; a field still referencing a dropped field type fails at
  codegen.

All six lists accumulate across layers: every layer's entries combine, deduped, so a layer can
drop components too and you can always add more.

## Content locales

`collections.locales` names the locales records may hold, as BCP-47 tags, and
`collections.defaultLocale` - which must be one of them - is where existing values land when a
field turns translatable:

```ts
collections: {
  locales: ['en', 'de-AT', 'fr'],
  defaultLocale: 'en',
},
```

They default to `['en']` and `'en'`. Content locales are not UI languages - the set is independent
of your message catalogs. See [translations](../database/translations.md).

## Messages

`messages.defaultLanguage` (default `'en'`) is the language a request falls back to when its own
language, and its parents, have no catalog entry. See [messages](../i18n/messages.md).

## The API server

`api` configures the HTTP server that `ohne serve api` runs:

```ts
api: {
  port: 3000,
  basePath: '/api',
},
```

- `port: 9001` - the port the server listens on.
- `host` - unset binds every interface.
- `basePath: ''` - the prefix every route mounts under. `'/api'` serves a `/authors` route at
  `/api/authors`, and the handler still sees `/authors`.

The rest are hardening knobs. Durations take milliseconds or a string like `'30s'`, sizes take
bytes or a string like `'1mb'`, and `false` means off - or Node's own default, where one exists:

- `handlerTimeout: '30s'` - how long middleware and the handler may run before a `503` answers.
- `maxBodySize: '1mb'` - largest request body; anything over is refused with `413`.
- `preStopDelay: false` - keep serving after a shutdown signal, so a load balancer can deregister.
- `shutdownTimeout: false` - how long in-flight requests may drain on shutdown.
- `deadline: false` - global deadline for every shutdown hook combined.
- `waitUntilTimeout: false` - how long a `waitUntil` promise may run after the response.
- `headersTimeout: false` - wait for the complete request headers; Node's default is 60 seconds.
- `requestTimeout: false` - the entire request, headers and body; Node's default is 5 minutes.
- `keepAliveTimeout: false` - idle keep-alive sockets between requests; Node's default is 5 seconds.
- `maxConnections: false` - cap on concurrent sockets.
- `maxHeaderSize: false` - largest request header block; Node's default is 16 KiB.
- `trustProxy: []` - CIDR ranges of proxies allowed to set `X-Forwarded-*` headers.
- `allowedHosts: []` - hostnames the server answers to; empty answers any host.

When and how to set these for production is covered in [deployment](../production/deployment.md).

## The dashboard

`dashboard` configures the dashboard's server, run by `ohne serve dashboard`:

- `port: 9000` - the port the dashboard listens on.
- `host` - unset binds every interface.
- `apiURL` - the absolute API base URL the browser calls, including any `api.basePath`. Omitted, it
  is derived from `api`; set it when the API sits at a different origin, such as behind a reverse
  proxy.

## The database

```ts
database: {
  url: '.data/app.db',
  helpers: { rateLimit: ':memory:' },
},
```

- `dialect: 'sqlite'` - ohne ships SQLite; other dialects are added by layers.
- `url: '.data/ohne.db'` - where the main database lives, as a URL the dialect understands. For
  SQLite a file path, created on demand, or `':memory:'` for an ephemeral database.
- `helpers: {}` - additional databases keyed by name, reached with `useDatabase('name')`. A helper
  holds no schema, only what you read and write. Any layer can contribute one; on a name clash the
  closer layer wins.
- `sync.force: false` - authorize destructive schema syncs on every boot. See
  [schema sync](../database/sync.md).

Connections, transactions, and helpers in depth: [engine](../database/engine.md).

## Query guards

`query.guards` overrides the DoS ceilings on wire-driven queries - the URL and POST-body query
paths. The fluent builder in your own code is trusted and never checked:

```ts
query: {
  guards: { maxInLength: 500, maxPerPage: 100 },
},
```

A ceiling you name replaces the framework default; the rest keep theirs. The full set and its
defaults live in [querying over HTTP](../api/url-queries.md#guards).

## The printer

`printer` controls terminal output:

- `silent: false` - `true` drops every print call.
- `debug: false` - `true` emits debug output.

The `SILENT` and `DEBUG` env vars take precedence whenever they are set, regardless of value; the
config fields apply only while the matching var is unset.

## Env vars win

A handful of env vars override their config counterpart whenever they are set:

- `PORT` - `api.port` and `dashboard.port`.
- `HOST` - `api.host` and `dashboard.host`.
- `API_URL` - `dashboard.apiURL`, and the URL derived from `api`.
- `DATABASE` - `database.url`. `DB` is an alias; setting both throws.
- `FORCE_SYNC` - `database.sync.force`, for a single boot.
- `SILENT` - `printer.silent`.
- `DEBUG` - `printer.debug`.

Each is also a CLI flag - the kebab-case of its name, so `FORCE_SYNC` is `--force-sync` - and the
flag wins over the env var for that run. The full list of built-ins lives in [env](./env.md).

## Own vs inherited keys

Config resolves per key, closest first: your value wins, and a layer's value fills in where you set
nothing. Nested groups merge key by key, so setting `api.handlerTimeout` does not discard a layer's
`api.basePath`.

Two kinds of keys resolve differently:

- **Accumulating** - the five `disable` lists combine entries across every layer, deduped.
- **Own** - never inherited: a layer's value applies to that layer alone, and only your own config
  reaches your app. These are `dirs`, `printer`, `api.port`, `api.host`, `dashboard.port`,
  `dashboard.host`, `dashboard.apiURL`, `database.dialect`, `database.url`, and
  `database.sync.force`.

The own list is a trust boundary: a dependency layer cannot move your ports, point you at its
database, silence your printer, or force a destructive sync. Leave an own key unset and the
framework default applies, no matter what any layer set.

## Reading config

`useConfig()` returns the resolved config - your `ohne.config.ts` merged with every layer -
anywhere in app code:

```ts
import { useConfig } from 'ohne';

const config = useConfig();

config.collections.locales;  // -> ['en']
config.api.basePath;         // -> ''
config.disable.routes;       // -> every layer's dropped globs, combined
```

Every defaulted field is guaranteed present, so none of the reads above need a fallback. Read it
inside a `computed` or an `effect` to re-run when the config changes.
