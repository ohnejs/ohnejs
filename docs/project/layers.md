# Layers

A layer is an installed ohne package your app builds on. It is a complete ohne project - routes,
collections, blocks, field types, messages, middleware, boot files, migrations, dashboard pages,
config - and your app stacks on top, keeping what fits and overriding the rest. ohne itself is a
layer: the scaffold lists it, and that one line is what gives every app the framework's built-in
messages and API routes.

```ts
// ohne.config.ts
import { defineConfig } from 'ohne';

export default defineConfig({
  layers: ['ohne', '@acme/blog'],
});
```

## Consuming a layer

Add the package to your `package.json` dependencies, then name it in `layers`. Installing alone
does nothing - only a listed layer stacks. Once codegen has run, installed layer names
autocomplete in the list; a fresh name codegen has not seen yet is still accepted.

A name can carry a subpath. `@acme/kit/auth` resolves through the package's `exports`; the
exported file is by convention that layer's `ohne.config.ts`, and its directory is the layer. One
package can ship several layers as exported subfolders.

A listed layer that cannot be used - the package is not installed, the subpath is not exported, or
the directory has no `ohne.config.ts` - fails the boot with an error naming the layer and who
listed it.

## The stack

Layers merge in one order everywhere: the list runs furthest-first, so a later entry overrides an
earlier one, and your app overrides them all.

Resolution cascades. Each layer's own config lists the layers it extends, and those load before
it, so listing `@acme/blog` also stacks whatever the blog layer builds on. A layer reached through
several entries loads once, beneath every layer that lists it. An app listing
`['ohne', '@acme/blog']`, where `@acme/blog` itself lists `['ohne']`, resolves to:

```
ohne -> @acme/blog -> app
```

`ohne` appears once, at the bottom, even though two configs name it.

## What overrides what

Every layer reads its content from its own directories - its own `dirs`, never an inherited one -
so a layer that renames `api/` to `routes/` moves only its own routes. See
[directories](./config.md#directories).

The pieces then merge by identity, and the closer layer wins:

- **Routes** - identity is method plus pattern: a closer `GET /posts` replaces a further one.
- **Dashboard pages** - identity is the page's pattern.
- **Messages** - identity is one key in one language. Merging is per key, never per file, so
  overriding one key leaves the rest of a layer's catalog in place.
- **Collections, blocks, and field types** - identity is the name; the closer definition replaces
  the further one entirely. A field type can even replace a built-in. Two surviving collection or
  block names differing only by case are an error - SQLite matches identifiers case-insensitively.
- **Middleware** - identity is the name, and the name must keep its tier: global in one layer and
  opt-in in another is an error.

Two kinds of content never collide:

- **Migrations** are layer-qualified, so every layer's run - furthest layer first, file name order
  within a layer. See [migrations](../database/migrations.md).
- **Boot files** all run, furthest layer first, so a base layer's hooks register before yours. See
  [boot](./boot.md).

## Disabling parts of a layer

`disable` subtracts after the whole stack combines - a layer's admin routes, a message group, a
collection you have no use for. The lists accumulate across layers, so a layer can drop components
too. The shapes live in [config](./config.md#disabling):

```ts
export default defineConfig({
  layers: ['ohne', '@acme/blog'],
  disable: {
    routes: ['GET /admin/**'],
    collections: ['Drafts'],
  },
});
```

## Authoring a layer

A layer is an ohne project - any directory with an `ohne.config.ts` at its root. There is nothing
to opt into: the app you already have is a valid layer. Give the package a name, publish it, and a
consumer can list it.

```
@acme/blog/
  package.json
  ohne.config.ts
  collections/Posts.ts
  api/posts.get.ts
  messages/en.json
```

```ts
// ohne.config.ts
import { defineConfig } from 'ohne';

export default defineConfig({
  layers: ['ohne'],
});
```

The config holds the layer's own values, like any project's: the layers it extends, its `dirs`,
whatever it sets for itself. Most keys resolve across the stack, closest first; a few are each
layer's own and never reach a consumer. See
[own vs inherited keys](./config.md#own-vs-inherited-keys).

## New config keys

A layer that introduces settings of its own declares them by augmenting `Config`, then ships an
`ohne.layer.ts` default-exporting `defineLayer` with what it owns: the defaults that floor the
stack and the merge strategies for its keys. The file is optional - present only when a layer adds
keys.

```ts
// ohne.layer.ts
import { defineLayer } from 'ohne';

declare module 'ohne' {
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

`defaults` fill wherever no project sets the key, never overriding one that does. A defaulted key
is guaranteed present once codegen has run, so `useConfig().blog.pageSize` reads without a
fallback.

`strategies` choose how a key merges across the stack, keyed by dot-notation path. Without one,
plain objects combine per key and everything else is replaced by the closer layer:

- `'replace'` - the closer value wins entirely; a layer that omits the key still inherits it.
- `'own'` - never inherited: each layer's value applies to that layer alone.
- `'defaults'` - recurse into objects per key and arrays per index; the longer side fills the rest.
- `'concat'` - arrays only: the closer layer's items first, then the lower layers'.
- `'concat-unique'` - `'concat'`, then duplicates are dropped.

The augmentation reaches consumers on its own: codegen finds every file in a stacked layer that
contains `declare module 'ohne'` and imports it into the app's type program, so your keys
autocomplete in a consuming `ohne.config.ts` exactly like the built-ins. Values the layer sets for
itself still belong in its `ohne.config.ts` - `ohne.layer.ts` describes only what it owns.
