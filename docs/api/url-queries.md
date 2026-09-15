# Querying over HTTP

A URL can carry a query. `parseQueryParams` reads the query out of the request, validates it against
your collection, and hands you a plan you replay through the builder. It is how you turn `?where=...`
into a filtered, ordered, paginated read without hand-parsing anything.

The [collections API](./collections.md) ships endpoints built on exactly this pipeline - reach for
this page when you build your own.

```ts
import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  resolveGuards,
  useSearchParams,
} from 'ohnejs';

export default defineHandler(async () => {
  const parsed = parseQueryParams(useSearchParams(), queryMetadata('Posts'), resolveGuards());
  return applyQuery(queryUntyped('Posts'), parsed).findMany();
});
```

Put that in `api/posts.get.ts` and `GET /posts?where={featured:true}&order=[-views]&limit=20` returns
the matching rows as JSON. The URL is untrusted, so every value is checked before it reaches the
database; a bad query comes back a `400`, never a broken read.

The URL grammar is the same one [`useSearchParams`](./request.md#search-params) speaks everywhere:
`1` is a number, `true` a boolean, `[a,b]` a list, `{k:v}` an object, and a leading backtick forces
a string (`` `1 `` is the string `"1"`).

`where`, `select`, `order`, `populate`, `limit`, `offset`, `page`, `perPage`, and `locale` are the
whole surface. Any other top-level parameter is a `400` with the code `unknownParam`.

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

Through the shipped collection endpoints, a conditioned `has` reaches into the target collection
only as far as the caller's own read of it would: a target the caller cannot read matches nothing,
a target's read scope narrows which of its rows match, and a target field outside that scope is
refused exactly as a field that does not exist. A bare `has` or `empty` tests the parent's own
link and never crosses.

A [blocks](../database/blocks.md#querying) field takes the same pair; a conditioned `has` scope
opens with a bare `block` equality naming the type its siblings probe:

```
?where={content:{has:{block:Hero,title:{contains:launch}}}}
```

A scope that names no type is a `400` with the code `blockTypeRequired` at `where.content`; a type
the field does not allow is `unknownBlockType` at `where.content.block`, with a suggestion when one
is close. Bare `has:true` and `empty:true` need no type.

The operators and what each field type admits are the same as the fluent builder. See
[reading records](../database/queries.md) for the full vocabulary.

## Selecting fields

`select` narrows the read to the fields you name. You get back exactly those, nothing more:

```
?select=[title,views]
```

A read with no `select` returns the whole record. An empty `select=[]` is a mistake, not a way to
ask for the id alone, so it is rejected. On a translatable collection the whole record includes
`_translations`, the locales it holds; name it to keep it under a narrowing `select`.

## Ordering

`order` is a list of fields. A leading `-` sorts descending; a plain name sorts ascending:

```
?order=[-views,title]
```

## The row window

`limit` and `offset` take a raw window:

```
?limit=20&offset=40
```

`page` and `perPage` read a page; `perPage` is clamped to the endpoint's ceiling:

```
?page=2&perPage=20
```

Mixing `limit` or `offset` with `page` or `perPage` is a `400`.

`applyQuery` leaves `page` and `perPage` to your endpoint, which decides whether to paginate - read
them off the parsed query and call `paginate` yourself:

```ts
export default defineHandler(async () => {
  const parsed = parseQueryParams(useSearchParams(), queryMetadata('Posts'), resolveGuards());
  const builder = applyQuery(queryUntyped('Posts'), parsed);
  if (parsed.page === null && parsed.perPage === null) return builder.findMany();
  return builder.paginate(parsed.page ?? 1, parsed.perPage ?? 20);
});
```

The paginated response carries `records` beside `total`, `page`, `perPage`, and `lastPage` -
everything a pager needs to render its controls.

## Populating relations

`populate` swaps a relation's ids for the full related records, exactly as the fluent
[`populate`](../database/queries.md) does:

```
?populate=[author,tags]
```

An entry can be a spec object instead of a bare name. Its keys are relation fields; each value
carries `select` - which target fields come back, `UUID` only when named - and `populate` for
the next level, the same grammar all the way down:

```
?populate=[{comments:{select:[text,author],populate:[{author:{select:[name]}}]}}]
```

A spec carrying any key other than `select` and `populate` is a `400` with the code
`invalidShape`; an empty `select` is `emptySelect` at its path. A populated relation must be
named in its level's `select` when one is set, or it silently drops.

Through the shipped collection endpoints, a populated relation hydrates only what the caller's own
read of the target would return: a `record` into a collection the caller cannot read comes back
`null`, a `records` element from one drops, and a target's read scope narrows the rows and the
fields at every level. Your endpoint scopes targets through `parseWireQuery`, whose last argument
maps each crossed collection to a read scope or `false`; `parseQueryParams` alone crosses unscoped.

Depth and size are bounded by the [guards](#guards) `maxPopulateDepth` (default `2`, so
`comments.author` works out of the box) and `maxPopulate` (default `20` nodes in total). Depth
past the default is new transitive reach across collections, so raising it is an explicit
endpoint decision.

## Locales

On a collection with [translatable fields](../database/translations.md), `locale` scopes the query
exactly as the fluent `.locale()` does:

```
?locale=de&where={title:{isNull:true}}
```

The tag must name a configured content locale - anything else is a `400` with the code
`invalidLocale`. On a collection with nothing translatable the parameter itself is a `400`,
`localeNotApplicable`. Without it, the endpoint's scope decides (below), then the default locale.

## Scoping an endpoint

The URL is untrusted; your endpoint is not. `applyQuery` takes an optional scope that the request
composes under but can never escape. A scoped `where` ANDs onto every request, a scoped `select`
intersects (a request narrows, never widens), and a scoped `limit` caps the request's own. Parse
against `scopedMetadata` so the fields outside the scope are hidden from the URL as well:

```ts
const scope = { where: { published: true }, select: ['title', 'body', 'author'], limit: 100 };
const parsed = parseQueryParams(useSearchParams(), scopedMetadata(meta, scope), resolveGuards());
applyQuery(queryUntyped('Posts'), parsed, scope).findMany();
```

Now `GET /posts` only ever reads published posts, only the three named fields, and at most 100 rows,
whatever the URL asks for. A hidden field named in `where`, `order`, `select`, or `populate` is
refused exactly as a field that does not exist, so the URL cannot filter or sort by it either.

A scoped `locale` is a default, not a wall: it applies when the request names none, and a request's
own `locale` wins. Locales select content, they do not protect it. `applyQuery` answers
`_translations` as stored; the shipped collection endpoints narrow it further, to the locales a
scoped `where` admits the record at.

`applyScope` composes the same scope onto a builder with no wire query to replay. To run your own
query under a collection's guard and `access`, use [`queryScoped`](./collections.md#your-own-routes).

The shipped collection endpoints take their scope from the operation's
[`access`](./collections.md#access) option, so a collection declares the rule once and every
endpoint composes under it.

## Reading from a POST body

A query long enough to strain a URL travels the same grammar as a JSON body. `readQueryBody` reads
it, and the parsed object feeds the same `parseQueryParams`:

```ts
import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  readQueryBody,
  resolveGuards,
} from 'ohnejs';

export default defineHandler(async () => {
  const parsed = parseQueryParams(await readQueryBody(), queryMetadata('Posts'), resolveGuards());
  return applyQuery(queryUntyped('Posts'), parsed).findMany();
});
```

The body must be a JSON object sent as `application/json` - a `+json` suffix works too, anything
else is a `415`. The same top-level keys apply, and a `maxDepth` option (default `32`) caps how
deep the JSON may nest before it is refused. The two transports parse to the same query, so a
`GET` and its `POST` equivalent read the same rows.

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
so a URL can never probe which fields your collection has. The complete catalog is the
`WireErrorCode` type, importable from `ohnejs`.

## Guards

The untrusted path is bounded so a hostile URL cannot exhaust the server. Each ceiling is a
`QueryGuards` field, with a default generous enough that a real query never approaches it:

| Guard              | Default | Caps                                                                |
| ------------------ | ------- | ------------------------------------------------------------------- |
| `maxConditions`    | `100`   | Comparisons in one `where`, `has` and `empty` included.             |
| `maxHasDepth`      | `8`     | How deep `has` nests.                                               |
| `maxInLength`      | `2000`  | Elements in an `in`, `includesAll`, or `includesAny` list.          |
| `maxBoundParams`   | `10000` | Parameters one query binds, capped at the database's own limit.     |
| `maxSelect`        | `200`   | Fields one `select` names.                                          |
| `maxOrder`         | `10`    | Keys in one `order`.                                                |
| `maxPopulate`      | `20`    | Nodes in one `populate` tree.                                       |
| `maxPopulateDepth` | `2`     | How deep `populate` nests.                                          |
| `maxValueBytes`    | `4096`  | Bytes in one string value.                                          |
| `maxPatternBytes`  | `512`   | Bytes in a `contains`, `startsWith`, `endsWith`, or `like` pattern. |
| `maxPerPage`       | `500`   | The largest `perPage`; a larger one clamps to it.                   |

The fluent builder is trusted and never checked.

Override a ceiling app-wide in `ohne.config.ts`:

```ts
export default {
  query: {
    guards: { maxPerPage: 100 },
  },
};
```

Pass `resolveGuards({ maxPerPage: 100 })` to raise or lower a ceiling for one endpoint.

The builder you replay onto can carry the same overrides with `.guards()`. They take effect only
when you pass that builder to `resolveGuards` as well:

```ts
export default defineHandler(async () => {
  const posts = queryUntyped('Posts').guards({ maxPopulateDepth: 3 });
  const parsed = parseQueryParams(useSearchParams(), queryMetadata('Posts'), resolveGuards(posts));
  return applyQuery(posts, parsed).findMany();
});
```

Only the ceiling moves: past it, `perPage` still clamps and everything else is still a `400` with
the same code.
