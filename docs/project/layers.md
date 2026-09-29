# Layers

A layer is an installed ohne package your app builds on. Your app stacks on top, keeping what fits
and overriding the rest. ohne ships its own content as a layer, `ohnejs/base`, which is why the
[scaffold lists it](../start/installation.md#the-project-files).

A layer can hold anything your app can: routes, collections, messages, dashboard pages, config, and
the rest.

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', '@acme/blog'],
});
```

## What the base layer ships

`ohnejs/base` holds the parts of ohne that are content, not the framework itself:

- The pages the [dashboard](../dashboard/pages.md) is made of: the overview, the collection tables,
  the record editor, the account page, and the sign-in and install screens. One endpoint gives them
  your collections, fields, and roles.
- [Authentication](../auth/authentication.md): the `Users` and `Sessions` collections, the session
  cookie, and the sign-in endpoints.
- The [collections API](../api/collections.md#the-routes) routes, which serve every collection that
  sets `api`.
- The [`admin` role](../auth/roles.md#defining-roles), holding `['*']`.
- The [global CORS policy](../api/middleware.md#cors), plus the opt-in `auth` and `require-auth`
  [middleware](../api/middleware.md#route-middleware).
- The field types `Users` is built from: [`password`](../database/field-types.md#password),
  [`roles`](../database/field-types.md#roles), [`language`](../database/field-types.md#language),
  [`locale`](../database/field-types.md#locale), [`timezone`](../database/field-types.md#timezone),
  and [`datePattern`](../database/field-types.md#datepattern).
- The [message catalogs](../i18n/messages.md#layers) that hold every framework string, in English,
  German, and Bosnian, and the [endpoint](../i18n/messages.md#the-catalog-endpoint) serving them.

The rest of ohne is not in the layer. The router, the query builder, the migration runner, codegen,
the [built-in field types](../database/field-types.md#built-in-types), and the dashboard's runtime
and server are the framework, and they are there whatever your `layers` list says.

[Uploads](../uploads/uploads.md) are not in it either. They are a layer of their own in the same
package, `ohnejs/uploads`, which you list when you want them.

## Going without it

ohne never adds an entry to `layers` for you, so an app that leaves `ohnejs/base` out gets none of
the above. That is a supported way to build: a headless API with its own auth does not need the
layer.

What you give up:

- The dashboard server still starts and still serves its shell, but no page matches any URL, so
  every URL renders a plain "Not found".
- There is no `Users` collection, no session cookie, and no sign-in endpoints.
  [Rolling your own](../auth/authentication.md#rolling-your-own) explains the pieces to write.
- No collection gets HTTP endpoints, whatever its `api` option says.
- Framework strings render as their own keys, because the catalogs that hold their text are in the
  layer.
- Every response carries `Access-Control-Allow-Origin: *` without credentials. The layer's policy is
  what limits it.

To keep the layer and drop one piece of it, use [`disable`](#disabling-parts-of-a-layer) instead.

## Consuming a layer

Add the package to your `package.json` dependencies, then name it in `layers`. Installing alone does
nothing. Only a listed layer stacks.

If a listed layer cannot load, the boot fails, and the error names the layer and who listed it. That
happens when:

- the package is not installed,
- the subpath is not exported, or
- the directory has no `ohne.config.ts`.

## The stack

Layers merge in the same order everywhere. The list starts with the furthest layer, so a later
entry overrides an earlier one, and your app overrides them all.

A layer's own layers load too. Each layer's own config lists the layers it extends, and those load
before it, so listing `@acme/blog` also stacks whatever the blog layer builds on. A layer that is
listed more than once loads once, below every layer that lists it. An app listing
`['ohnejs/base', '@acme/blog']`, where `@acme/blog` itself lists `['ohnejs/base']`, resolves to:

```
ohnejs/base -> @acme/blog -> app
```

`ohnejs/base` appears once, at the bottom, even though two configs name it.

## What overrides what

Every layer reads its content from its own [directories](./config.md#directories), so a layer that
renames `api/` to `routes/` moves only its own routes.

The pieces merge by identity, and the closer layer wins:

| Piece                                                                 | Identity                                  |
| --------------------------------------------------------------------- | ----------------------------------------- |
| [Routes](../api/routes.md#routes-across-layers)                       | Method plus pattern, such as `GET /posts` |
| Dashboard pages                                                       | The page's pattern                        |
| [Dashboard boot files](../dashboard/pages.md#boot-files)              | The path under the dashboard directory    |
| [Messages](../i18n/messages.md#layers)                                | One key in one language                   |
| Collections, blocks, field types, middleware, roles, skills, commands | The name                                  |

- The closer definition replaces the further one entirely, including
  [roles](../auth/roles.md#roles-across-layers), and a closer dashboard boot file runs instead of
  the further one.
- Messages merge per key, never per file, so overriding one key keeps the rest of a layer's
  catalog.
- A [field type](../database/custom-field-types.md#where-field-types-live) can replace a built-in.
- Two surviving collection or block names that differ only by case are an error, since SQLite
  matches identifiers case-insensitively.
- A [middleware name](../api/middleware.md#names-and-layers) keeps its tier. Global in one layer and
  opt-in in another is an error.

Some content never collides:

- [Migrations](../database/migrations.md#a-migration-file) include their layer in their name, so
  every layer's migrations run. The furthest layer runs first, and files run in name order within a
  layer.
- [Boot files](./boot.md#ordering) all run, furthest layer first, so a base layer's hooks
  register before yours.

## Disabling parts of a layer

`disable` removes parts of the stack after the layers are combined, such as a layer's admin routes
or a collection you do not need. [Config](./config.md#disabling) explains what each list accepts and
how the lists combine:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', '@acme/blog'],
  disable: {
    routes: ['GET /admin/**'],
    collections: ['Drafts'],
  },
});
```

## Authoring a layer

A layer is an ohne project - any directory with an `ohne.config.ts` at its root. There is nothing
to enable: the app you already have is a valid layer. Give the package a name, publish it, and a
consumer can list it. This is all of `@acme/blog`:

`ohne.config.ts`

```ts files
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
});
```

`package.json`

```json files
{
  "name": "@acme/blog",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "ohnejs": "^0.0.1"
  }
}
```

`collections/Posts.ts`

```ts files
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    body: field('text'),
  },
});
```

`api/posts.get.ts`

```ts files
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Posts').findMany());
```

`messages/en.json`

```json files
{
  "blog": {
    "empty": "No posts yet"
  }
}
```

The config holds the layer's own values, like any project's. A few keys
[stay with the layer](./config.md#own-vs-inherited-keys) and never reach a consumer.

## Several layers in one package

A package can ship several layers as exported subpaths. `@acme/kit/auth` resolves through the
`exports` in its `package.json`:

```json
{
  "name": "@acme/kit",
  "exports": {
    "./auth": "./auth/ohne.config.ts",
    "./billing": "./billing/ohne.config.ts"
  }
}
```

- By convention, the exported file is that layer's `ohne.config.ts`, and its directory is the
  layer.
- A conditional target resolves as Node would, through `node`, `import`, or `default`.
- The package can be one already in your stack, including your own app. An app named `acme` whose
  `package.json` exports `./uploads` can list `acme/uploads`.

Subpath layers autocomplete in `layers` like any other.

## New config keys

To add settings of its own, a layer augments `Config` and ships an `ohne.layer.ts`:

```ts
// ohne.layer.ts
import { defineLayer } from 'ohnejs';

declare module 'ohnejs' {
  interface Config {
    blog?: {
      pageSize?: number;
      badWords?: string[];
    };
  }
}

export default defineLayer({
  defaults: { blog: { pageSize: 20, badWords: [] } },
  strategies: { 'blog.badWords': 'concat-unique' },
});
```

`ohne.layer.ts` default-exports `defineLayer` with what the layer owns. A layer needs the file only
when it adds config keys or generates files.

- `defaults` apply when no project sets the key. Once codegen has run, a key with a default is
  always present, so you read [`useConfig()`](./config.md#reading-config)`.blog.pageSize` without a
  fallback.
- `strategies` choose how a key merges across the stack. You name each key by its dot-notation
  path. Without a strategy, plain objects combine per key, and the closer layer replaces anything
  else.

| Strategy          | How the key merges                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `'replace'`       | The closer value wins entirely. A layer that omits the key still inherits it.                                                      |
| `'own'`           | Never inherited. Each layer's value applies to that layer alone.                                                                   |
| `'defaults'`      | Recurses into objects per key and arrays per index. The longer side fills the rest.                                                |
| `'assign'`        | Objects merge one level: keys union, and the closer value replaces per key without recursing. Non-objects behave like `'replace'`. |
| `'concat'`        | Arrays only. The closer layer's items first, then the lower layers'.                                                               |
| `'concat-unique'` | `'concat'`, then duplicates are dropped.                                                                                           |

Consumers get autocomplete for your keys automatically, exactly like the built-ins. Values the layer
sets for itself still belong in its `ohne.config.ts`. `ohne.layer.ts` describes only what it owns.

## Generating files

A layer can also write files into the consuming app's
[codegen directory](./config.md#directories). Declare them under
`codegen` in `ohne.layer.ts`, each with a bucket, a file name, and a `code` function that returns
the content. `code` runs once the whole stack has loaded, so it can read the merged config. That is
how a layer gives a type to something that only the app's own `ohne.config.ts` decides:

```ts
// ohne.layer.ts
import { defineLayer, useConfig } from 'ohnejs';

declare module 'ohnejs' {
  interface Config {
    blog?: {
      categories?: string[];
    };
  }
}

export default defineLayer({
  defaults: { blog: { categories: [] } },
  codegen: [
    {
      bucket: 'node',
      file: 'blog-categories.ts',
      code: () =>
        [
          "import type {} from '@acme/blog';",
          '',
          "declare module '@acme/blog' {",
          '  interface KnownCategories {',
          ...useConfig().blog.categories.map((name) => `    ${name}: true;`),
          '  }',
          '}',
          '',
        ].join('\n'),
    },
  ],
});
```

`KnownCategories` is an empty interface that the layer exports. The generated file fills it with the
app's values, so a field typed `keyof KnownCategories` autocompletes the categories that app
configured.

- `bucket` picks which TypeScript program sees the file: `node` for `ohnejs` augmentations and
  server types, `browser` for `ohnejs/dashboard` ones, `shared` for pure types both include.
- `file` is a plain `.ts` name inside the bucket. Two entries in the stack cannot use the same
  name, and the error names both layers. Names ohne generates itself, like `routes.ts`, are taken.

The file is written to `.ohne/node/blog-categories.ts` by default, with the
[ohne banner](./cli.md#ohne-prepare) on its first line. It is rewritten only when its content
changes, and deleted once the layer stops declaring it.
