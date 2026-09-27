# The collections API

A collection can serve itself over HTTP. Add one option to the definition, and ohne ships REST
endpoints for it. Reads take the [URL query](./url-queries.md) grammar, and writes run the same
[validation](../database/writing.md) as the query builder.

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

`GET /collections/posts?where={views:{atLeast:100}}&order=[-views]` now returns the matching records
as JSON, to anyone, because `read` is `'public'`. Creating needs a signed-in user who has the
`collection.Posts.create` [capability](../auth/roles.md#the-collections-api-guard), because an
exposed operation is guarded unless you mark it public. A collection without `api` has no endpoints
at all.

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
POST   /collections/posts/verdicts                    ask which records a write may touch
GET    /collections/posts/[uuid]/translations         list the locales holding a translation
POST   /collections/posts/[uuid]/translations/copy    copy one locale's translation onto another
DELETE /collections/posts/[uuid]/translations         delete one locale's translation
```

The [translation routes](#translations) exist only on collections with translatable fields. On any
other collection they answer the same `404` as an unknown collection.

These are ordinary [routes](./routes.md) shipped by the `ohnejs/base` layer, so they work like every
other route:

- [`api.basePath`](../project/config.md#the-api-server) prefixes them.
- Your app [overrides](./routes.md#routes-across-layers) one by shipping the same route id.
- [`disable: { routes: ['/collections/**'] }`](../project/config.md#disabling) drops all of them.

## Reading

The list endpoint accepts the whole [URL query grammar](./url-queries.md): `where`, `select`,
`order`, `populate`, `limit`/`offset` or `page`/`perPage`, and `locale`.

- With `page` or `perPage`, it answers a paginated object: `records`, `total`, `page`, `perPage`,
  and `lastPage`. Otherwise it answers a plain array.
- `perPage` defaults to `20` when only `page` is named.

A query that is too long for a URL goes in a JSON body instead. `POST /collections/posts/query`
takes the same top-level keys and runs the same read:

```
POST /collections/posts/query
{ "where": { "views": { "atLeast": 100 } }, "order": ["-views"], "limit": 20 }
```

The by-`UUID` read returns one record. Only `select`, `populate`, and `locale` shape it. A filter or
window param is a `400`, because the `UUID` already selects the row. No matching record is a `404`.

A record of a translatable collection carries `_translations` in every read and write answer: the
locales where it has a translation. Under an [`access`](#access) scope it lists only the locales
where the scope allows the record, so a translation the scope hides never shows.

## Writing

`POST` creates a record from a JSON body and answers `201` with the stored record. Defaults are
filled and sanitizers have run, so it is exactly what a later read returns.

```
POST /collections/posts
{ "title": "Hello", "views": 0 }
```

- `PATCH` updates one record and answers with its final state.
- `DELETE` answers `204`.
- A translatable collection writes one locale at a time: `?locale=de` on the create or update writes
  that locale's values.

[Failures](./errors.md#write-failures) have the same shapes as in the rest of ohne:

- A validation failure is a `422` with translated messages keyed by field path, exactly as
  [writing records](../database/writing.md#the-result) reports them.
- A malformed query is a `400` with a stable `code` and `path`, as
  [querying over HTTP](./url-queries.md#errors) describes. A malformed body is a plain `400`.
- A delete blocked by a `restrict` reference is a `409`.
- A busy database is a `503` with `Retry-After`.

A [write-only field](../database/collections.md#write-only-and-locked-fields) never comes back in a
response unless the operation's [`access`](#access) scope names it. If a query names one, or a write
body names an `immutable` or `writable: false` field, the request is rejected as if the field did
not exist.

## Translations

The translation routes manage a record's locales as units, on a collection with
[translatable fields](../database/translations.md):

- `GET /collections/posts/[uuid]/translations` answers `{ locales }`: the locales where the record
  has a translation, in the configured order. It is the same list as its `_translations`, so a
  read scope whose `select` leaves `_translations` out answers `404`.
- `POST /collections/posts/[uuid]/translations/copy`
  [copies a translation](../database/translations.md#copying-a-translation). An optional JSON body
  names the `source` locale, `?locale=` names the target, and it answers the target's new state.
- `DELETE /collections/posts/[uuid]/translations`
  [removes all of one locale's values](../database/translations.md#deleting-translations).
  `?locale=de` drops the German translation, and the record and every other locale stay. It answers
  `204`, or `404` when the record had no translation there.

Each one runs under an operation's rules: the `GET` under `read`, the copy under `update`, and the
`DELETE` under `delete`. The copy runs `update`'s [`access`](#the-write-input) twice: first with an
empty input to reach the source record, then with the values it is about to write.

## Exposure

An exposed operation is guarded by default: the request needs a signed-in user whose
[capabilities](../auth/roles.md#the-collections-api-guard) cover `collection.<Name>.<operation>`.
`api: true` opens every operation, all of them guarded. An object opens operations one by one, and
any operation it does not name stays closed:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  api: {
    read: 'public',
    create: true,
    update: { middleware: ['audit'] },
  },
  fields: {
    title: field('text'),
    views: field('integer'),
  },
});
```

An operation is one of:

- `true` - guarded.
- `'public'` - open to anyone.
- An object of options:
  - `public: true` - the same as `'public'`, in the object form.
  - `middleware` - [middleware](./middleware.md#route-middleware) to run after the guard, in order,
    after the global ones. A middleware that returns a value answers the request, and the operation
    never runs.
  - [`access`](#access) - narrows the operation to the records and fields a request may reach.

`public` and `middleware` work together: `{ public: true, middleware: ['require-auth'] }` skips the
capability guard but still
[requires a signed-in user](../auth/authentication.md#protecting-routes-with-middleware): any
account, no role needed.

`read` covers every read endpoint. An unknown collection, an unexposed one, and a closed operation
all answer the identical `404`, so the API never reveals what exists.

A [singleton](../database/collections.md#singletons) opens `read` and `update` only. Its create,
delete, and translation delete routes always answer that `404`, and its list returns the one record.

## Access

The guard decides whether a caller may run an operation at all. `access` decides which records and
fields the operation reaches. It is a function on the operation. It runs once per request, after the
guard and the middleware. [Asking before a write](#asking-before-a-write) runs it without the
middleware. What it returns is applied to every query the operation runs:

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

Anyone can read posts. A signed-in user can update only the posts they wrote. The `where` is added
to the update with AND, so a `PATCH` on someone else's post answers the same `404` as a missing
record. A record outside the scope never answers `403`. It looks exactly like a missing one, so the
API never reveals what the caller cannot reach.

What `access` returns decides:

- `true` runs the operation without a scope, exactly as if the option were omitted.
- `false` refuses it with that same `404`.
- A [scope](#the-scope) object narrows it.

### The scope

A scope object carries these keys:

- `where` - a filter in the object form that the URL [`where`](./url-queries.md#filtering) takes,
  with the collection's fields as keys. It is added to every request with AND, so a request can
  filter further but can never escape it.
- `select` - the fields the request may reach. A read returns those fields, and a request's own
  `select` can only choose among them. On an update the same list limits the body: only fields in
  the list are written, and the answered record carries only the scoped fields.
- `limit` - the maximum for a list read's `limit`/`offset` window. The request's own `limit` can
  only lower it. A paginated read takes its size from `perPage` instead, which the
  [`maxPerPage` guard](./url-queries.md#guards) limits.
- `locale` - the locale a read uses when the request names none. It is only a default, so a request
  can still name another locale.

A field outside `select` is refused in `where`, `order`, `select`, and `populate` exactly as a field
that does not exist. That includes `UUID`, so name it when clients address rows.

A `read` scope applies to every read endpoint. An `update` or `delete` scope decides which rows the
write may touch: a row outside `where` answers `404` as if it did not exist. A client can
[ask before it writes](#asking-before-a-write). A create has no rows yet, so only `true` or `false`
applies.

The filter checks the row as it is stored, so an update body can move a row out of the scope, for
example when an author gives a post to someone else. Protect such a field through the scope's
`select`, or lock it with
[`writable: false`](../database/collections.md#write-only-and-locked-fields).

When another collection's endpoint [populates or probes](./url-queries.md#across-relations) this
one, this collection's own `read` exposure, guard, scope, and middleware decide what comes back. If
one of its middleware answers, this collection cannot be reached that way.

A `where` on translatable fields matches per locale, so it can allow a record in `en` and hide it in
`de`. The endpoints then reduce the record's `_translations` to the allowed locales. They also refuse
a request's filter on `_translations` with `invalidField`, because it would reveal the hidden ones.
A `where` on plain fields gives the same answer in every locale, costs no extra read, and keeps the
filter.

### Who is asking

`access` receives a context naming the `operation`. The caller is not passed in: read it with
`useUser`, `requireUser`, and [`userCan`](../auth/roles.md#guarding-your-own-routes) from
`ohnejs/auth`, exactly as in a [handler](../auth/authentication.md#reading-the-current-user). This
way a rule is ordinary code. In this example:

- the author, any listed editor, or the author's manager may edit,
- only the author may delete,
- only the author may give a post to someone else,
- a `posts.manage` [capability](../auth/roles.md#custom-capabilities) bypasses the editing rule.

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

`manager` is a [`record`](../database/field-types.md#record) field to `Users` that your own `Users`
collection declares. `editors` is a [`records`](../database/field-types.md#records) field, so `has`
matches a listed editor, and `author` reaches the author's own `manager`.

`author` defaults to the signed-in user, and the create rule lets a body name only the caller, so a
create gets its owner. An update that names `author` is limited to the author's own rows, so when an
editor tries to reassign a post, the answer is `404`. Lock the field with `writable: false` instead
when nobody may change it.

Give a bypass a name outside the `collection.` prefix.
[`collection.Posts.*`](../auth/roles.md#capabilities) covers every name under it, including
`collection.Posts.manage`, so a role meant for plain editing would have the bypass too.

### The write input

A create or update carries `input` in the context: the JSON body as the request sent it, before
validation. A rule can judge the write itself, not only the row it changes. The example above lets
only the author reassign `author`, and with `input.status === 'published'` a rule can require a
manager before a post is published. A read or delete carries no input. Its context names only the
operation, so one function can serve every operation by branching on `operation`.

### Asking before a write

An `update` or `delete` scope shows only when the write answers `404`. A client that wants to know
sooner, to hide an Edit button for example, names the records and asks:

```
POST /collections/posts/verdicts
{ "UUIDs": ["0198c3a2-7b1e-7d40-9f2a-5c1e8d3b6a10"] }
```

It answers `{ update, delete }`. Each holds the `UUIDs` that operation's scope allows, and `update`
adds the scope's [`select`](#the-scope) when it has one. The answer is a label, not a promise: the
write still checks for itself.

- The request runs under [`read`](#exposure)'s rules and never names a record the read hides. A
  closed operation, a missing capability, and a `false` from `access` allow no records.
- Without `UUIDs` it counts instead: the body takes the list's
  [`where`](./url-queries.md#filtering), and each operation answers a `total`.
- `locale` in the body is the locale the update writes. `delete` always checks the default locale,
  as the record delete does.
- A translatable collection also answers `deleteTranslation`: the
  [translation delete](#translations) at `locale`.

Asking runs `access` with an [empty input](#the-write-input) and without the operation's
[middleware](#exposure), so a question never counts against a write's rate limit. Read the caller
[as a handler does](#who-is-asking), never from something a middleware set. An `access` that throws
an HTTP error, like `requireUser` without a user, allows no records.

The dashboard asks this for every collection whose `update` or `delete` has `access`, so an editor
sees Edit and Delete only where the rule allows.

### Your own routes

`access` applies only to the shipped endpoints. A query in your own route is trusted and has no
scope. To apply the same policy to a route, open the query through `queryScoped` from `ohnejs/auth`.
It runs the guard and `access` exactly as the collections API does, and returns a builder to query
through:

- A closed operation or a `false` from `access` is a `404`.
- A missing user is a `401`, and a missing capability a `403`.
- A read carries the whole scope. An update or delete adds the scope's `where` with AND, exactly as
  the shipped endpoints do.

The builder takes the same object grammar as the URL `where`:

```ts
// api/drafts.get.ts
import { defineHandler } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';

export default defineHandler(async () => {
  const posts = await queryScoped('Posts', 'read');
  return posts.where({ status: 'draft' }).findMany();
});
```

A create or update takes the input you plan to write as its third argument, so the rule can judge
it. The operation's own middleware do not run here, so your route needs its own. For a rule that
must apply to every read in the process, shipped or not, use a
[`query:filter` hook](../project/hooks.md#queryfilter).
