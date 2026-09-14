# The collections API

A collection can serve itself over HTTP. One option on the definition, and ohne ships REST
endpoints for it - reads through the full [wire query grammar](./url-queries.md), writes through
the same validation the query builder runs.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  api: { read: 'public', create: true },
  fields: {
    title: field('text'),
    views: field('integer'),
  },
});
```

`GET /collections/posts?where={views:{atLeast:100}}&order=[-views]` now returns the matching
records as JSON, to anyone - `read` is `'public'`. Creating needs a signed-in user holding the
`collection.Posts.create` [capability](../auth/roles.md), because an exposed operation is guarded
unless marked public. Nothing is exposed without `api` - a collection that does not opt in has no
endpoints at all.

## The routes

The URL segment is the collection's kebab-case name: `Posts` serves at `/collections/posts`,
`UserGroups` at `/collections/user-groups`.

```
GET    /collections/posts                             list records
POST   /collections/posts/query                       the same list read, query in the body
POST   /collections/posts                             create a record
GET    /collections/posts/[uuid]                      read one record
PATCH  /collections/posts/[uuid]                      update one record
DELETE /collections/posts/[uuid]                      delete one record
GET    /collections/posts/[uuid]/translations         list the locales holding a translation
POST   /collections/posts/[uuid]/translations/copy    copy one locale's translation onto another
DELETE /collections/posts/[uuid]/translations         delete one locale's translation
```

The three translation routes apply only to collections with
[translatable fields](../database/translations.md); on any other they answer the same `404` as an
unknown collection. The `GET` answers exactly the record's own `_translations` field.

These are ordinary [routes](./routes.md) shipped by the ohne layer, so everything routes do
applies: `api.basePath` prefixes them, your app overrides one by shipping the same route id, and
`disable: { routes: ['/collections/**'] }` drops them wholesale.

## Reading

The list endpoint speaks the whole [URL query grammar](./url-queries.md): `where`, `select`,
`order`, `populate`, `limit`/`offset` or `page`/`perPage`, and `locale`. With `page` or `perPage`
it answers the paginated envelope (`records`, `total`, `page`, `perPage`, `lastPage`); otherwise a
plain array. `perPage` defaults to `20` when only `page` is named.

A query too long for a URL travels as a JSON body instead. `POST /collections/posts/query` takes
the same top-level keys and parses to the identical read:

```
POST /collections/posts/query
{ "where": { "views": { "atLeast": 100 } }, "order": ["-views"], "limit": 20 }
```

The by-`UUID` read returns one record, shaped by `select`, `populate`, and `locale` alone - a
filter or window param is a `400`, since the `UUID` already pins the row. No matching record is a
`404`.

A record of a translatable collection carries `_translations`, the locales it holds a translation
at, in every read and write answer. Under an `access` scope it lists only the locales the scope
admits the record at, so a translation the scope hides never shows.

## Writing

`POST` creates from a JSON body and answers `201` with the stored record - defaults filled,
sanitizers run, exactly what a re-read returns. `PATCH` updates one record and answers with its
final state; `DELETE` answers `204`. A translatable collection writes one locale at a time:
`?locale=de` on the create or update addresses that locale's values.

The translation routes manage those locales as units. The `GET` lists the locales at which the
record holds a translation, in the configured order. The copy takes an optional JSON body naming
the `source` locale and projects its translatable values onto `?locale=`'s target, answering the
target's new state. The `DELETE` removes one locale's values whole - `?locale=de` drops the
German translation while the record and every other locale survive, `204` on success and `404`
when the record held nothing there. Reads gate on the `read` operation, the copy on `update`, and
the translation delete on `delete`.

```
POST /collections/posts
{ "title": "Hello", "views": 0 }
```

Failures keep the shapes the rest of ohne uses:

- A validation failure is a `422` with translated messages keyed by field path, exactly as
  [writing records](../database/writing.md) reports them.
- A malformed query or body is a `400` with a stable `code` and `path`; see
  [errors](./errors.md).
- A delete blocked by a `restrict` reference is a `409`; a busy database a `503` with
  `Retry-After`.

A [write-only field](../database/collections.md#write-only-and-locked-fields) never comes back in
a response unless the operation's [`access`](#access) scope names it, and naming one in a query is
indistinguishable from naming a field that does not exist. An `immutable` or `writable: false`
field in a write body rejects the same way.

## Exposure

An exposed operation is guarded by default: the request needs a signed-in user whose
[capabilities](../auth/roles.md) cover `collection.<Name>.<operation>`. No user answers `401`; a
user without the capability `403`. `api: true` opens every operation guarded. An object opens per
operation, and anything unnamed stays closed:

```ts
export default defineCollection({
  api: {
    read: 'public',
    create: true,
    update: { middleware: ['audit'] },
  },
  fields: { ... },
});
```

An operation is `true` (guarded), `'public'` (open to anyone), or an object with three options.
`public: true` is the object spelling of `'public'`, and `middleware` names
[middleware](./middleware.md) to run after the guard, in order, after the global ones. A
middleware that returns a value answers the request, and the operation never runs. `access`
narrows the operation to the records and fields a request may reach; it has
[its own section](#access).

`public` and `middleware` compose: `{ public: true, middleware: ['require-auth'] }` skips the
capability guard but still requires a signed-in user - any account, no role needed.

`read` covers all three read endpoints. An unknown collection, an unexposed one, and a closed
operation all answer the identical `404`, so the API never reveals what exists.

## Access

The guard decides whether a caller may run an operation at all. `access` decides which records and
fields the operation reaches. It is a function on the operation, run once per request after the
guard and the middleware, and what it returns composes into every query the operation runs:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';
import { useUser } from 'ohnejs/auth';

export default defineCollection({
  api: {
    read: 'public',
    update: {
      access: async () => {
        const user = await useUser();
        return user ? { where: { author: user.UUID } } : false;
      },
    },
  },
  fields: {
    title: field('text'),
    author: field('record', { collection: 'Users' }),
  },
});
```

Anyone reads posts. A signed-in user updates only the posts they authored: the `where` ANDs onto
the update, so a `PATCH` on someone else's post answers the same `404` a missing record does. There
is no `403` to tell an out-of-scope record from an absent one, so the API never reveals what the
caller cannot reach.

`access` returns one of three things. `true` runs the operation unscoped, exactly as if the option
were omitted. `false` refuses it as that identical `404`. A scope object narrows it.

### The scope

`where` is a filter in the object form the URL grammar's [`where`](./url-queries.md#filtering)
takes, keyed to the collection's fields. Every request is ANDed under it: a request can filter
further, never escape.

`select` names the fields the request may reach. A read returns those fields, and a request's own
`select` narrows within them. A field outside them is refused in `where`, `order`, `select`, and
`populate` exactly as a field that does not exist - `UUID` included, so name it when clients
address rows. On an update the same list bounds the body: only fields inside it write, and the
answered record carries the scoped fields alone.

`limit` caps the rows a list read returns; the request's own `limit` can only lower it. `locale` is
the locale a read uses when the request names none - a default, not a wall.

A `read` scope also reaches through relations. When another collection's endpoint populates or
probes this one, this collection's own `read` exposure, guard, and scope decide what comes back:
nothing from a collection the caller cannot read, only the admitted rows and fields otherwise. The
target's own middleware run too; one that answers makes the target unreachable.

A `read` scope shapes all three read endpoints. An `update` or `delete` scope decides which rows
the write may touch: a row outside `where` answers `404` as if it did not exist. The filter reads
the row as stored, so a body may carry a row out of the scope - an author handing a post to someone
else. Keep a field inside the scope with `select`, or lock it with `writable: false` as the next
example does. A create has no rows yet, so only the verdict applies - return `true` or `false`.

A `where` over translatable fields matches per locale, so it can admit a record at `en` and hide it
at `de`. The endpoints then narrow the record's `_translations` to the admitted locales; a `where`
over plain fields answers alike everywhere and costs no extra read.

### Who is asking

`access` receives a context naming the `operation`. The caller is not in it: the caller is
ambient, and `useUser`, `requireUser`, and `userCan` from `ohnejs/auth` read the request exactly as
they do in a [handler](../auth/authentication.md#reading-the-current-user). That keeps a rule
ordinary code. Here the author, any listed editor, or the author's manager may edit, only the
author may delete, only the author hands a post to someone else, and a `posts.manage` capability
bypasses the editing rule:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';
import { requireUser, useUser, userCan } from 'ohnejs/auth';

export default defineCollection({
  api: {
    read: true,
    create: {
      access: async ({ input }) => {
        const me = (await requireUser()).UUID;
        return !('author' in input) || input.author === me;
      },
    },
    update: {
      access: async ({ input }) => {
        const user = await requireUser();
        if (userCan(user, 'posts.manage')) return true;
        const me = user.UUID;
        if ('author' in input) return { where: { author: me } };
        return {
          where: {
            or: [
              { author: me },
              { editors: { has: { UUID: me } } },
              { author: { has: { manager: me } } },
            ],
          },
        };
      },
    },
    delete: { access: async () => ({ where: { author: (await requireUser()).UUID } }) },
  },
  fields: {
    title: field('text'),
    author: field('record', {
      collection: 'Users',
      default: async () => (await useUser())?.UUID ?? null,
    }),
    editors: field('records', { collection: 'Users' }),
  },
});
```

`manager` is a `record` field to `Users` that your own `Users` collection declares. The `has`
clauses read through the relations: `editors` is a `records` field, so `has` matches a listed
editor, and `author` reaches the author's own `manager`.

Name a bypass outside the `collection.` prefix. `collection.Posts.*` covers every name under it,
`collection.Posts.manage` included, so a role meant for plain editing would hold the bypass too.

`author` defaults to the ambient user, so a create that leaves it out carries its creator, and
the create rule lets a body name only the caller - that is how a create gets its owner, since the
scope has no row to filter yet. An update naming `author` narrows to the author's own rows, so an
editor's attempt to reassign answers `404`. Lock the field with `writable: false` instead when
nobody may change it.

### The write input

A create or update carries `input` in the context: the JSON body as the request sent it, before
validation. A rule can judge the write itself, not only the row it lands on - the example above
lets only the author reassign `author`, and `input.status === 'published'` is how a rule asks for
a manager before a post goes live. A read or delete carries no input; its context names the
operation alone, so one function serves every slot by branching on `operation`.

The translation copy resolves `update` twice: with an empty input to reach the source record,
then with the values it is about to write.

### Your own routes

`access` belongs to the shipped endpoints; a query in your own route is trusted and unscoped. To
hold a route to the same policy, open the query through `queryScoped` from `ohnejs/auth`. It runs
the guard and the resolver exactly as the collections API does - a closed operation or a `false`
verdict is a `404`, a missing user `401`, a missing capability `403` - and returns a builder to
query through. A read carries the whole scope; an update or delete ANDs the scope's `where` in,
exactly as the shipped endpoints do. The builder speaks the object grammar the URL `where` takes:

```ts
// api/drafts.get.ts
import { defineHandler } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';

export default defineHandler(async () => {
  const posts = await queryScoped('Posts', 'read');
  return posts.where({ status: 'draft' }).findMany();
});
```

A create or update takes the intended input as its third argument, so the rule judges it. The
operation's own middleware do not run here; your route carries its own. A rule that must reach
every read in the process, shipped or not, is a [`query:filter` hook](./hooks.md).
