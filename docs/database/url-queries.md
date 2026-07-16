# Querying over HTTP

A URL can carry a query. `parseQueryParams` reads the query out of the request, validates it against
your collection, and hands you a plan you replay through the builder. It is how you turn `?where=...`
into a filtered, ordered, paginated read without hand-parsing anything.

```ts
import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  resolveGuards,
  useSearchParams,
} from 'ohne';

export default defineHandler(async () => {
  const parsed = parseQueryParams(useSearchParams(), queryMetadata('Posts'), resolveGuards());
  return applyQuery(queryUntyped('Posts'), parsed).findMany();
});
```

Put that in `api/posts.get.ts` and `GET /posts?where={featured:true}&order=[-views]&limit=20` returns
the matching rows as JSON. The URL is untrusted, so every value is checked before it reaches the
database; a bad query comes back a `400`, never a broken read.

The URL grammar is the same one [`useSearchParams`](./collections.md) speaks everywhere: `1` is a
number, `true` a boolean, `[a,b]` a list, `{k:v}` an object, and a leading backtick forces a string
(`` `1 `` is the string `"1"`).

## Filtering

`where` is a condition object, the same shape the fluent `.where()` builds. A bare `field:value`
matches on equality; a `{ op: value }` object is a comparison:

```
?where={status:published}
?where={views:{atLeast:100}}
?where={title:{contains:ohne}}
```

Sibling keys AND. Add an `or` array beside them for a disjunction, and `not` to negate a comparison:

```
?where={featured:true,or:[{pinned:true},{views:{atLeast:1000}}]}
?where={status:{not:{equalsTo:draft}}}
```

`null` is never a value. To match a null field, use `isNull`:

```
?where={summary:{isNull:true}}
```

A relation filters with `has`, re-scoped to the target's fields, and `empty` for its opposite:

```
?where={author:{has:{name:Ada}}}
?where={tags:{empty:true}}
```

The operators and what each field type admits are the same as the fluent builder. See
[reading records](./queries.md) for the full vocabulary.

## Selecting fields

`select` narrows the read to the fields you name. You get back exactly those, nothing more:

```
?select=[title,views]
```

A read with no `select` returns the whole record. An empty `select=[]` is a mistake, not a way to
ask for the id alone, so it is rejected.

## Ordering

`order` is a list of fields. A leading `-` sorts descending; a plain name sorts ascending:

```
?order=[-views,title]
```

## The row window

Two windowing modes, and a query uses one or the other. `limit` and `offset` take a raw window:

```
?limit=20&offset=40
```

`page` and `perPage` read a page; the endpoint pins `paginate` as its terminal to serve the totals.
`perPage` is clamped to the endpoint's ceiling:

```
?page=2&perPage=20
```

Mixing the two modes is a `400`.

## Populating relations

`populate` swaps a relation's ids for the full related records, one level deep, exactly as the
fluent [`populate`](./queries.md) does:

```
?populate=[author,tags]
```

## Locales

On a collection with [translatable fields](./translations.md), `locale` scopes the query exactly as
the fluent `.locale()` does:

```
?locale=de&where={title:{isNull:true}}
```

The tag must name a configured content locale - anything else is a `400` with the code
`invalidLocale`. On a collection with nothing translatable the parameter itself is a `400`,
`localeNotApplicable`. Without it, the endpoint's scope decides (below), then the default locale.

## Scoping an endpoint

The URL is untrusted; your endpoint is not. `applyQuery` takes an optional scope that the request
composes under but can never escape. A scoped `where` ANDs onto every request, a scoped `select`
intersects (a request narrows, never widens), and a scoped `limit` caps the request's own:

```ts
applyQuery(queryUntyped('Posts'), parsed, {
  where: { published: true },
  select: ['title', 'body', 'author'],
  limit: 100,
}).findMany();
```

Now `GET /posts` only ever reads published posts, only the three named fields, and at most 100 rows,
whatever the URL asks for.

A scoped `locale` is a default, not a wall: it applies when the request names none, and a request's
own `locale` wins. Locales select content, they do not protect it.

## Reading from a POST body

A query long enough to strain a URL travels the same grammar as a JSON body. `readQueryBody` reads
it, and the parsed object feeds the same `parseQueryParams`:

```ts
import { parseQueryParams, queryMetadata, readQueryBody, resolveGuards } from 'ohne';

export default defineHandler(async () => {
  const parsed = parseQueryParams(await readQueryBody(), queryMetadata('Posts'), resolveGuards());
  return applyQuery(queryUntyped('Posts'), parsed).findMany();
});
```

The body must be a JSON object with `Content-Type: application/json`; the same top-level keys apply.
The two transports parse to the same query, so a `GET` and its `POST` equivalent read the same rows.

## Errors

A bad query throws a `400` that serializes to a small, stable shape:

```json
{
  "statusCode": 400,
  "message": "Unknown or unusable field `titel`. Did you mean `title`?",
  "data": { "code": "invalidField", "path": "where.titel" }
}
```

`data.code` is a stable machine string your client can switch on; `data.path` locates the problem in
the query. An unknown field and an operator a field does not support both collapse to `invalidField`,
so a URL can never probe which fields your collection has.

## Guards

The untrusted path is bounded so a hostile URL cannot exhaust the server: a cap on conditions, `has`
nesting, `in` length, selected fields, order keys, value and pattern size, and page size. The
defaults are generous, and a real query never approaches one. The fluent builder is trusted and
never checked.

Override a ceiling app-wide in `ohne.config.ts`:

```ts
export default {
  query: {
    guards: { maxPerPage: 100 },
  },
};
```

Pass `resolveGuards({ maxPerPage: 100 })` to raise or lower a ceiling for one endpoint.
