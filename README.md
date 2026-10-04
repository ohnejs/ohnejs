# ohne

A zero-dependency TypeScript framework for the web. "ohne" is German for "without".

You get a database, an HTTP API, internationalization, and a dashboard, with no build step. The
framework ships `.ts` source, your app is `.ts` source, and Node 26 runs both directly. What you
write is what runs.

Without means:

- **No runtime dependencies.** `ohnejs` is the only entry in your `dependencies`. Under it are
  Node's own modules: `node:sqlite` for the database, `node:http` for the server.
- **No build step.** Node strips the types and runs your files. The dashboard is served the same
  way, from `.ts` on disk to JavaScript in the browser.
- **No registration.** Where a file sits decides what it is. A file in `collections/` is a
  collection, a file in `api/` is a route, a file in `dashboard/pages/` is a page.

## Requirements

Node.js 26 or newer. Node runs your TypeScript by stripping the types, so you are limited to syntax
it can strip: no `enum`, for example.

## Install

```sh
npm create ohne my-app
cd my-app
npm run dev
```

The dashboard is at `http://localhost:9000` and the API at `http://localhost:9001`. Both reload as
you save. Open the dashboard and create the first user. That account gets the `admin` role.

The scaffold writes `ohne.config.ts`, `package.json`, `tsconfig.json`, and a `.gitignore`.
[Installation](./docs/start/installation.md) walks through each one.

## A first app

A collection is one file under `collections/`, named after it:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    body: field('text'),
  },
});
```

Save it, and the `Posts` table exists in `.data/ohne.db`. There is no migration to write. ohne syncs
the schema against your collections at every boot, and refuses a change that would lose data.

A route is one file under `api/`. Its path is the URL, and the `.get` suffix is the method:

```ts
// api/posts.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Posts').findMany());
```

`curl http://localhost:9001/posts` answers `[]`. `query('Posts')` is typed from the collection you
just wrote, so a wrong field name is a compile error.

[Your first app](./docs/start/tutorial.md) continues from here: a `POST` route with validation, and
a dashboard page that lists the posts.

## The pieces

### Config

`ohne.config.ts` at the root is what makes a directory an ohne project. Every key is optional and
has a default, so the scaffold's config is already complete:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
});
```

`useConfig()` returns the resolved config anywhere in your code, and environment variables like
`PORT` and `DATABASE` override the keys they name.
[Configuration](./docs/project/config.md) lists every key, and
[Environment variables](./docs/project/env.md) the built-ins.

### Layers

A layer is an ohne project you install as a package and build on. Everything it ships becomes part
of your app, and anything you define yourself wins.

ohne ships its own content this way. `ohnejs/base` holds users and sign-in, the collections API,
the dashboard pages, the `admin` role, and the framework's message catalogs. An app that leaves it
out gets a headless API with none of that. Your own app is already a valid layer: give it a package
name and another project can stack it. [Layers](./docs/project/layers.md) covers the stack and
what overrides what.

### Collections and queries

A collection is a set of fields. Each field becomes a column, a relation, or a nested table, and
`query` reads and writes the records with every name, operator, and result typed from your schema:

```ts
const popular = await query('Posts')
  .where('views', (w) => w.atLeast(100))
  .findMany();
```

Writes validate first. `create` never throws for bad input: it returns a result with the record,
or the failing fields. Fields can be translatable, conditional, or built from reusable blocks.

- [Collections and fields](./docs/database/collections.md), and
  [every field type](./docs/database/field-types.md).
- [Reading](./docs/database/reading.md) and [writing](./docs/database/writing.md) records.
- [Schema sync](./docs/database/sync.md) and [migrations](./docs/database/migrations.md).
- [Translations](./docs/database/translations.md) and [blocks](./docs/database/blocks.md).

### Routes

A route's return value is the response: objects become JSON, a string becomes HTML, a `Response`
is sent as it is. Composables read the rest of the request inside the handler, `readJSONBody` and
`useSearchParams` among them, and failures are thrown as `notFound()` or another named error.

Middleware lives in `middleware/` and runs before the handler. A collection can also serve itself
over HTTP by setting `api` in its definition.

- [Routes](./docs/api/routes.md), the [request](./docs/api/request.md), and the
  [response](./docs/api/response.md).
- [Middleware](./docs/api/middleware.md) and [rate limiting](./docs/api/rate-limiting.md).
- [The collections API](./docs/api/collections.md) and
  [querying over HTTP](./docs/api/url-queries.md).

### Auth and roles

The `ohnejs/base` layer ships email and password accounts, session cookies, the `/auth` endpoints,
and `useUser` from `ohnejs/auth` to read the signed-in user in a handler.

Authorization is capability-based. A role is a file under `roles/`, and a user holds any number of
them:

```ts
// roles/editor.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.Posts.*', 'collection.Tags.read'],
});
```

[Authentication](./docs/auth/authentication.md) and [roles](./docs/auth/roles.md) cover both.

### Messages

Translatable strings live in JSON catalogs under `messages/`, one file per language. Values are
ICU MessageFormat templates, and `useT` translates a key in the language of the current request:

`messages/en.json`

```json
{
  "inbox": {
    "unread": "You have {count, plural, one {# unread message} other {# unread messages}}"
  }
}
```

```ts
// api/inbox.get.ts
import { defineHandler, useT } from 'ohnejs';

export default defineHandler(() => {
  const t = useT();
  return { status: t('inbox.unread', { count: 3 }) };
});
```

Codegen types every key, so `t('inbox.unraed')` is a compile error.
[Messages](./docs/i18n/messages.md) and [ICU MessageFormat](./docs/i18n/icu.md) go deeper.

### Commands

A command adds a word to `ohne` for work outside a request. Each file under `commands/` is one:

```ts
// commands/seed.ts
import { query } from 'ohnejs';
import { defineCommand } from 'ohnejs/utils/cli';

export default defineCommand({
  meta: { name: 'seed', description: 'Add the first post.' },
  async run() {
    await query('Posts').create({ title: 'Hello', body: 'First post.' });
  },
});
```

`npx ohne seed` runs it with your app booted and the database connected.
[Commands](./docs/project/commands.md) covers flags and subcommands.

### Dashboard

The dashboard is your app's browser UI, served by ohne from your `.ts` files. A page is one file
under `dashboard/pages/`, and its path is the route. Rendering is plain DOM, with reactivity per
value: wrap a value in a function and the runtime keeps that one place up to date.

```ts
// dashboard/pages/counter.ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

export default defineDashboardPage(() => {
  const count = ref(0);
  return h('button', { onClick: () => count.value++ }, () => `Count: ${count.value}`);
});
```

The base layer ships the pages a dashboard needs: the overview, a table and an editor for every
collection, sign-in, and account settings. Your pages sit beside them and call your API through a
typed `api()` helper.

- [Pages](./docs/dashboard/pages.md), [rendering](./docs/dashboard/rendering.md), and
  [reactivity](./docs/dashboard/reactivity.md).
- [Data in the dashboard](./docs/dashboard/data.md) and
  [field layouts](./docs/dashboard/field-layouts.md).

### Uploads

`ohnejs/uploads` is a layer for files: storage with a backend you can replace, an `Uploads`
collection, upload and serve routes, media fields for your own collections, and a Media page in the
dashboard. Stack it when you need it:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
});
```

[Uploads](./docs/uploads/uploads.md) covers storage, resumable uploads, image variants, and
private files.

### Assistant

`ohnejs/ai` is a layer that puts an assistant behind Cmd+K in the dashboard. A person asks in plain
words, the model proposes the HTTP requests, and the person approves them. Their own browser sends
each one with their own session, so the assistant can never do more than the person can.
[The assistant](./docs/ai/assistant.md) covers models, what reaches them, and skills.

### The CLI

`ohne dev` runs everything while you work. `ohne prepare` generates the types, `ohne serve api` and
`ohne serve dashboard` run one backend each in production, and `ohne sync` updates the database
schema. Your app and its layers add commands of their own.
[The CLI](./docs/project/cli.md) lists every flag.

### Production

Your app deploys as the source you wrote: install, then `ohne serve api` and `ohne serve dashboard`
under your process manager. The port opens only after the schema has synced, so an accepted
connection means the server is ready. `ohne sync --dry-run` rehearses a schema change against the
live database before the new build takes over.
[Deployment](./docs/production/deployment.md) covers persistence, proxies, and shutdown.

## Documentation

The guides live in [`docs/`](./docs/index.md), from installation to deployment. JSDoc on every
export is the reference.

## Working on ohne

The repository is the package. Its root `ohne.config.ts` is a dev app that stacks `ohnejs/base`.

```sh
pnpm install
pnpm dev
```

- `src/ohne/` is the framework, `src/utils/` the isomorphic utilities, `src/dashboard/` the browser
  runtime.
- `src/base/`, `src/uploads/`, and `src/ai/` are the layers ohne ships.
- `tests/` mirrors `src/`.

`pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm format` must pass before a commit.

## License

[MIT](./LICENSE)
