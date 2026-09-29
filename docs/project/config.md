# Configuration

`ohne.config.ts` at the root is what makes a directory an ohne project. The CLI, the servers, and
codegen all recognize the project by this one file. It default-exports a `defineConfig` call, which
adds type checking and autocomplete to a plain object:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
});
```

Every key is optional and every key has a default, so this scaffold config is already complete.
Layers document the keys they add, like [`auth`](../auth/authentication.md#configuration) and
[`uploads`](../uploads/uploads.md#configuration).

## Layers

A layer is an ohne project you install as a package and build on. Everything it ships becomes part
of your app: routes, collections, messages, dashboard pages. Anything you define yourself wins.

Say you run several services, and each one needs the same API keys collection, the same roles, and
the same audit-log middleware. Put them in one base layer and list it in every service. You fix a
bug once, and every service gets the fix. If one service needs to log differently, it overrides just
that middleware.

ohne ships its own content as a layer too. That is why the scaffold lists `ohnejs/base`: it brings
users, sign-in, and the dashboard. A service on your base layer lists both:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', '@acme/service-base'],
});
```

Later entries override earlier ones, and your project overrides them all. Defaults to `[]`.
The [layers guide](./layers.md) shows how to add a layer and build your own.

## Directories

`dirs` sets where ohne reads each kind of file, relative to the layer's own root. `codegen` is the
only one ohne writes to. It is a single directory for the whole stack, at your project's root:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dirs: {
    api: 'routes',
  },
});
```

- `codegen: '.ohne'` - where [generated `.ts` files](./cli.md#ohne-prepare) land.
- `api: 'api'` - [API route files](../api/routes.md#files-and-urls).
- `boot: 'boot'` - [boot files](./boot.md), run once at start.
- `middleware: 'middleware'` - [middleware](../api/middleware.md). Files in its `global/`
  subdirectory [run on every request](../api/middleware.md#global-middleware).
- `messages: 'messages'` - [message catalogs](../i18n/messages.md#catalogs), one JSON file per
  language.
- `collections: 'collections'` -
  [collection definitions](../database/collections.md#files-and-names).
- `fields: 'fields'` -
  [custom field types](../database/custom-field-types.md#where-field-types-live).
- `blocks: 'blocks'` - [block definitions](../database/blocks.md#defining-a-block).
- `roles: 'roles'` - [role definitions](../auth/roles.md#defining-roles).
- `skills: 'skills'` - skill definitions, the prompts the dashboard assistant runs on request.
- `flows: 'flows'` - flow definitions, the graphs of decisions and steps the assistant walks.
- `migrations: 'migrations'` - [database migrations](../database/migrations.md#a-migration-file).
- `commands: 'commands'` - [CLI commands](./commands.md#names).
- `dashboard: 'dashboard'` - [dashboard pages](../dashboard/pages.md#from-file-to-route) and
  components.

`dirs` is [never inherited](#own-vs-inherited-keys). Each layer reads its own, so renaming your
`api` directory to `routes` moves only your routes.

## Disabling

`disable` lets you use a layer without taking everything it ships. It drops components after the
layers are combined, so what you list here applies to anything in the stack, including your own:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  disable: {
    routes: ['GET /admin/**'],
    messages: ['dashboard.**'],
    collections: ['Drafts'],
  },
});
```

- `routes` - globs over route ids. A glob with a method prefix, like `'GET /admin/**'`, matches only
  that method. Without one it matches every method. When you drop a collection's create, update, or
  delete route, or an uploads route, the dashboard hides the controls that call it.
- `messages` - globs over the dot-separated key, so `dashboard.**` drops the whole group. A dropped
  key vanishes from the [catalog endpoint](../i18n/messages.md#the-catalog-endpoint),
  [`useT`](../i18n/messages.md#translating-with-uset), and the generated
  [`KnownMessages`](../i18n/messages.md#typed-keys) type.
- `collections`, `fields`, `blocks`, `roles`, `skills`, `flows` - exact names. A dropped collection
  or block vanishes from the schema and the generated types. A field still referencing a dropped
  field type fails at codegen.

The lists accumulate across layers: every layer's entries are combined, with duplicates removed. So
a layer can drop components too, and you can always add more.

## Content locales

`collections.locales` names the locales that records may hold, as BCP-47 tags.
`collections.defaultLocale` must be one of them. When you make a field translatable, its existing
values move to the default locale.

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  collections: {
    locales: ['en', 'de-AT', 'fr'],
    defaultLocale: 'en',
  },
});
```

- They default to `['en']` and `'en'`.
- Tags are canonicalized for you, so `de-at` becomes `de-AT`.

Content locales are separate from the languages of your message catalogs.
[Translations](../database/translations.md) covers marking fields and reading per locale.

## Messages

`messages.defaultLanguage` (default `'en'`) is the language a request
[falls back to](../i18n/messages.md#translating-with-uset) when its own language, and its parents,
have no catalog entry:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  messages: {
    defaultLanguage: 'de',
  },
});
```

## The API server

`api` configures the HTTP server that `ohne serve api` runs:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  api: {
    port: 3000,
    basePath: '/api',
  },
});
```

Durations take milliseconds or a string like `'30s'`. Sizes take bytes or a string like `'1mb'`.
`false` turns a limit off, or leaves Node's own default where one exists.

| Key                 | Default    | What it does                                                                                                          |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `port`              | `9001`     | The port the server listens on.                                                                                       |
| `host`              | -          | The host to bind. Unset binds every interface.                                                                        |
| `basePath`          | `''`       | Prefix for every route. With `'/api'`, `/authors` is served at `/api/authors`, and the handler still sees `/authors`. |
| `handlerTimeout`    | `'30s'`    | How long middleware and the handler may run before the server answers with `503`.                                     |
| `maxBodySize`       | `'1mb'`    | Largest request body. A larger body is refused with `413`.                                                            |
| `preStopDelay`      | `false`    | Keeps serving after a shutdown signal, so a load balancer can deregister.                                             |
| `shutdownTimeout`   | `false`    | How long running requests may take to finish on shutdown, before they are cancelled.                                  |
| `deadline`          | `false`    | Deadline for every shutdown hook combined, the cleanup of cancelled requests included.                                |
| `waitUntilTimeout`  | `false`    | How long a [`waitUntil`](../api/response.md#after-the-response) promise may run after the response.                   |
| `headersTimeout`    | `false`    | Wait for the complete request headers. Node's default is 60 seconds.                                                  |
| `requestTimeout`    | `false`    | The whole request, headers and body. Node's default is 5 minutes.                                                     |
| `keepAliveTimeout`  | `false`    | Idle keep-alive sockets between requests. Node's default is 5 seconds.                                                |
| `maxConnections`    | `false`    | Limit on concurrent sockets.                                                                                          |
| `maxHeaderSize`     | `false`    | Largest request header block. Node's default is 16 KiB.                                                               |
| `trustProxy`        | `[]`       | CIDR ranges of proxies allowed to set `X-Forwarded-*` headers.                                                        |
| `allowedHosts`      | `[]`       | Hostnames the server answers to. Empty answers any host.                                                              |
| `rateLimitStore`    | `'memory'` | Where [rate limits](../api/rate-limiting.md#across-processes) count: each process, or a shared `'database'`.          |
| `rateLimitDatabase` | -          | The helper database the `'database'` store counts in.                                                                 |

`handlerTimeout`, `maxBodySize`, and `waitUntilTimeout` can also be set
[per route](../api/routes.md#per-route-options).

For production, [deployment](../production/deployment.md) covers when to set these: for
[capacity](../production/deployment.md#capacity), a
[graceful shutdown](../production/deployment.md#graceful-shutdown), and running
[behind a proxy](../production/deployment.md#behind-a-proxy).

## The dashboard

`dashboard` configures the dashboard's server, run by `ohne serve dashboard`:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dashboard: {
    apiURL: 'https://api.example.com',
    origin: 'https://admin.example.com',
  },
});
```

| Key      | Default | What it does                                                                                                                                                                          |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`   | `9000`  | The port the dashboard listens on.                                                                                                                                                    |
| `host`   | -       | The host to bind. Unset binds every interface.                                                                                                                                        |
| `apiURL` | -       | Absolute base URL of the API the browser calls, including any `api.basePath`. Unset, it is derived from `api`.                                                                        |
| `origin` | -       | Absolute origin the browser reaches the dashboard at. The API's [CORS](../api/middleware.md#cors) accepts credentialed requests from it. Unset, it is derived from `host` and `port`. |
| `menu`   | -       | The [sidebar groups](../dashboard/pages.md#the-sidebar), in order. Unset, the sidebar starts with the overview row, then lists every accessible collection in one unlabeled group.    |

The defaults fit local development, where the browser reaches both servers directly. In production,
give `apiURL` and `origin` the public URLs instead.
[Deployment](../production/deployment.md#what-a-deploy-needs) covers the pair behind a proxy, where
a wrong `origin` makes the browser block every dashboard request.

## The database

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  database: {
    url: '.data/app.db',
    helpers: { cache: ':memory:' },
  },
});
```

- `dialect: 'sqlite'` - ohne ships SQLite. Layers can add
  [other dialects](../database/engine.md#other-dialects).
- `url: '.data/ohne.db'` - where the main database lives, as a URL the dialect understands. For
  SQLite this is a file path, created if missing, or `':memory:'` for a temporary database.
- `helpers: {}` - additional databases keyed by name, reached with
  [`useDatabase('name')`](../database/engine.md#helper-databases). A helper holds no schema, only
  what you read and write. Any layer can contribute one. When two layers use the same name, the
  closer layer wins.
- `sync.force: false` - [allow destructive schema syncs](../database/sync.md#force) on every boot.

The [database guide](../database/engine.md) covers connections, transactions, and helper databases.

## Query guards

`query.guards` overrides the limits on queries that arrive over HTTP, in the URL or a POST body.
Queries you build in your own code are trusted and never checked:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  query: {
    guards: { maxInLength: 500, maxPerPage: 100 },
  },
});
```

A limit you set replaces its default. The others keep theirs.
Keep `maxLimit` at or above `maxInLength`, so a `UUID` `in` list gets back every row it names.
[Querying over HTTP](../api/url-queries.md#guards) lists every limit and its default.

## The printer

`printer` controls terminal output:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  printer: {
    silent: true,
  },
});
```

- `silent: false` - `true` drops every print call.
- `debug: false` - `true` prints debug output.

## Env vars win

Some env vars override a config key whenever they are set, such as `PORT` over `api.port` and
`dashboard.port`:

```sh
PORT=4000 npx ohne serve api
```

[Environment variables](./env.md#environment-beats-config) lists each one and the
full order.

## Reading config

`useConfig()` returns the resolved config: your `ohne.config.ts` merged with every layer. Call it
anywhere in app code:

```ts
import { useConfig } from 'ohnejs';

const config = useConfig();

config.collections.locales; // -> ['en']
config.api.basePath;        // -> ''
config.disable.routes;      // -> every layer's dropped globs, combined
```

Every field with a default is always present, so none of the reads above need a fallback. Read it
inside a [`computed`](../dashboard/reactivity.md#computed) or an
[`effect`](../dashboard/reactivity.md#effect) to re-run when the config changes.

## Own vs inherited keys

This matters when your project stacks layers. Config resolves per key, closest first: your value
wins, and a layer's value fills in where you set nothing. Nested groups merge key by key, so setting
`api.handlerTimeout` keeps a layer's `api.basePath`.

Some keys resolve differently:

- **Accumulating** - each `disable` list combines every layer's entries, without duplicates.
- **Own** - never inherited. A layer's value applies to that layer alone. An own key you leave unset
  takes the framework default, even if a layer sets it. These are `dirs`, `printer`, `api.port`,
  `api.host`, `dashboard.port`, `dashboard.host`, `dashboard.apiURL`, `dashboard.origin`,
  `dashboard.menu`, `database.dialect`, `database.url`, and `database.sync.force`.

A base layer and your project both set `api`:

```ts
// the base layer
api: { basePath: '/v1', port: 4000 },

// your project
api: { handlerTimeout: '10s' },

// resolved for your project
api: { basePath: '/v1', handlerTimeout: '10s' },
```

`basePath` fills in from the layer. `port` is an own key, so it stays with the layer and your server
listens on the default `9001`.

Own keys are a trust boundary. A dependency layer cannot move your ports, point you at its
database, silence your printer, or force a destructive sync.

The same boundary covers `dashboard.menu`: a layer that ships dashboard pages cannot add sidebar
rows. List them yourself, or have the layer append them through the
[`dashboard:menu`](./hooks.md#dashboardmenu) hook.
