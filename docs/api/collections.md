# The collections API

A collection can serve itself over HTTP. One option on the definition, and ohne ships REST
endpoints for it - reads through the full [wire query grammar](./url-queries.md), writes through
the same validation the query builder runs.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohne';

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
unknown collection.

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
a response, and naming one in a query is indistinguishable from naming a field that does not
exist. An `immutable` or `writable: false` field in a write body rejects the same way.

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

An operation is `true` (guarded), `'public'` (open to anyone), or an object with two options.
`public: true` is the object spelling of `'public'`, and `middleware` names
[middleware](./middleware.md) to run after the guard, in order, after the global ones. A
middleware that returns a value answers the request, and the operation never runs.

The two options compose: `{ public: true, middleware: ['require-auth'] }` skips the capability
guard but still requires a signed-in user - any account, no role needed.

`read` covers all three read endpoints. An unknown collection, an unexposed one, and a closed
operation all answer the identical `404`, so the API never reveals what exists.

## Scoping a read

The shipped endpoints serve records as they are. To constrain what every request sees - only
published posts, only the caller's own rows - register a [`query:filter` hook](./hooks.md), or
override the route file and compose your own scope with `applyQuery`; the
[URL query guide](./url-queries.md#scoping-an-endpoint) shows the pattern.
