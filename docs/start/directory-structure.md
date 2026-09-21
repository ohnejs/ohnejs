# Directory structure

In ohne, where a file sits decides what it is. A file in `collections/` is a collection, a file in
`api/` is a route, and a file in `dashboard/pages/` is a dashboard page. You never register or
import these files. ohne finds them by their location.

A new project has none of these directories. You create each one the first time you need it. A
project that uses all of them looks like this:

```text
my-app/
├── api/                  HTTP routes
├── blocks/               reusable content shapes
├── boot/                 code that runs once at startup
├── collections/          your data model
├── dashboard/
│   ├── boot/             code that runs once when the dashboard loads
│   ├── components/       UI code your pages share
│   ├── pages/            dashboard pages
│   └── tsconfig.json
├── fields/               custom field types
├── messages/             translatable strings
├── middleware/
│   └── global/           middleware that runs on every request
├── migrations/           data moves for schema changes
├── roles/                who may do what
├── .data/                the local database
├── .ohne/                generated types
├── .env                  local environment variables
├── ohne.config.ts
├── package.json
└── tsconfig.json
```

The rest of this page walks through them, one part of the app at a time.

## Data

- `collections/` - one file per [collection](../database/collections.md#files-and-names). The file
  names the collection, so `collections/Posts.ts` is `Posts`, and ohne creates its table for you.
- `fields/` - [custom field types](../database/custom-field-types.md#where-field-types-live).
  `fields/slug.ts` defines a `slug` type, which any collection uses as `field('slug')`.
- `blocks/` - [blocks](../database/blocks.md#defining-a-block), reusable content shapes like a hero
  or a quote. `blocks/Hero.ts` defines `Hero`.
- `migrations/` - [migrations](../database/migrations.md#a-migration-file). Each file describes one
  change that has to carry data along, like renaming a field.

## API

- `api/` - [routes](../api/routes.md#files-and-urls). The file's path is the URL, and a suffix sets
  the method: `api/posts.get.ts` is `GET /posts`.
- `middleware/` - [middleware](../api/middleware.md), functions that run before a route's handler.
  A file under `middleware/global/` runs on every request. Any other file runs only on the routes
  that select it.

## Dashboard

Everything under `dashboard/` is browser code. ohne serves it to the browser as it is, so treat
the whole directory as public. Server code lives outside it, and the two talk over HTTP.

- `dashboard/pages/` - [pages](../dashboard/pages.md#from-file-to-route). The file's path is the
  route: `dashboard/pages/posts.ts` is `/posts`.
- `dashboard/boot/` - [dashboard boot files](../dashboard/pages.md#boot-files). Each one runs once
  in the browser, before the first page renders.
- `dashboard/components/` - the UI code your pages share. This one is only a habit. ohne reads
  `pages/` and `boot/`, and the rest of `dashboard/` is yours to arrange. Pages
  [import it](../dashboard/pages.md#what-a-page-may-import) through the `app/` prefix.
- `dashboard/tsconfig.json` - [type-checks](../dashboard/pages.md#type-checking) the browser code
  against DOM types, apart from your Node code.

## Across the app

- `boot/` - [boot files](../project/boot.md). Each one runs once at startup, before the server
  opens. This is where you register [hooks](../project/hooks.md).
- `roles/` - [roles](../auth/roles.md#defining-roles), one per file. `roles/editor.ts` is the
  `editor` role, a named set of permissions you give to users.
- `messages/` - [message catalogs](../i18n/messages.md#catalogs), the strings your app translates.
  One JSON file per language: `messages/en.json`, `messages/de.json`.

## Files ohne writes

You do not create these, and the scaffold's `.gitignore` keeps them out of git:

- `.ohne/` - the [types ohne generates](../project/cli.md#ohne-prepare) from your project. They are
  what makes your queries, routes, and messages typed in the editor. You never edit or import them.
- `.data/` - the [local database](../database/engine.md#where-the-database-lives), a SQLite file
  that ohne creates on the first boot.

`.env` is also ignored, but you write that one yourself. It holds
[local environment variables](../project/env.md#the-env-file), such as secrets.

The files at the root are covered in [Installation](./installation.md#the-project-files).

## Renaming a directory

The names above are defaults. If you would rather keep your routes in `routes/`, set
[`dirs`](../project/config.md#directories) in your config:

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

## Layers share the structure

A [layer](../project/layers.md) is an ohne project you build on, and it uses these same
directories. The `ohnejs/base` layer in your config has its own `collections/`, `api/`, and
`dashboard/`, which is where your app's users, sign-in, and dashboard come from.

When your project and a layer define the same thing, like a route with the same URL or a collection
with the same name, [yours wins](../project/layers.md#what-overrides-what).

Next, [Your first app](./tutorial.md) fills some of these directories: a collection, two routes,
and a dashboard page.
