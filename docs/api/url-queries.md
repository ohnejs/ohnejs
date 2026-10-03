# Querying over HTTP

A URL can carry a query. `parseQueryParams` reads the query out of the request, validates it against
your collection, and gives you a plan that you apply to the builder. This is how you turn
`?where=...` into a filtered, ordered, paginated read without parsing anything by hand.

The [collections API](./collections.md) ships endpoints built on exactly this pipeline. Read this
page when you build your own.

```ts
// api/posts.get.ts
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

Put that in `api/posts.get.ts` and `GET /posts?where={featured:true}&order=[-views]&limit=20`
returns the matching rows as JSON. The URL is untrusted, so every value is checked before it reaches
the database. A bad query returns a `400`, never a broken read.

The URL grammar is the same one [`useSearchParams`](./request.md#search-params) uses everywhere:

- `1` is a number, and `true` a boolean.
- `[a,b]` is a list, and `{k:v}` an object.
- A leading backtick forces a string: `` `1 `` is the string `"1"`.

`where`, `select`, `order`, `populate`, `limit`, `offset`, `page`, `perPage`, and `locale` are the
only parameters. Any other top-level parameter is a `400` with the code `unknownParam`.

## Filtering

`where` is a condition object, the same shape the fluent `.where()` builds, with the same
[operators per field type](../database/reading.md#filtering):

- A bare `field:value` matches when the field equals the value.
- A `{ op: value }` object is a comparison.

```
?where={status:published}
?where={views:{atLeast:100}}
?where={title:{contains:ohne}}
```

Keys in the same object are combined with AND. Add an `or` array beside them to match any of its
conditions, and `not` to negate a comparison:

```
?where={featured:true,or:[{pinned:true},{views:{atLeast:1000}}]}
?where={status:{not:{equalsTo:draft}}}
```

`null` is never a value. To match a null field, use [`isNull`](../database/reading.md#null):

```
?where={summary:{isNull:true}}
```

Filter on a relation with [`has`](../database/reading.md#filtering-relations). Its conditions apply
to the target's fields. Use `empty` for the opposite:

```
?where={author:{has:{name:Anduin}}}
?where={tags:{empty:true}}
```

Through the shipped collection endpoints, a `has` with conditions sees only the parts of the target
that the caller may read, as [across relations](#across-relations) describes.

A [blocks](../database/blocks.md#querying) field takes the same pair. A `has` scope with conditions
starts with a bare `block` equality. It names the block type that the other conditions test:

```
?where={content:{has:{block:Hero,title:{contains:launch}}}}
```

- A scope that names no type is a `400` with the code `blockTypeRequired` at `where.content`.
- A type the field does not allow is `unknownBlockType` at `where.content.block`, with a suggestion
  when a similar type exists.
- Bare `has:true` and `empty:true` need no type.

## Selecting fields

`select` narrows the read to the fields you name. You get back exactly those, nothing more:

```
?select=[title,views]
```

- A read with no `select` returns the whole record. On a translatable collection, it includes
  `_translations`, the locales the record holds. Name it in a `select` to keep it.
- An empty `select=[]` is rejected. It is a mistake, not a way to ask for the id alone.

## Ordering

`order` is a list of fields. A leading `-` sorts descending, and a plain name sorts ascending:

```
?order=[-views,title]
```

## The row window

`limit` and `offset` set the window directly:

```
?limit=20&offset=40
```

`page` and `perPage` read a page, and a `perPage` above the endpoint's [ceiling](#guards) is lowered
to it:

```
?page=2&perPage=20
```

Mixing `limit` or `offset` with `page` or `perPage` is a `400`.

A `limit` above `maxLimit` is lowered to it. A read without `page` or `perPage` answers at most
`maxLimit` rows, even with no `limit` or with `offset` alone.

`applyQuery` leaves `page` and `perPage` to your endpoint, which decides whether to paginate. Read
them from the parsed query and call [`paginate`](../database/reading.md#pagination) yourself:

```ts
// api/posts.get.ts
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
  const builder = applyQuery(queryUntyped('Posts'), parsed);
  if (parsed.page === null && parsed.perPage === null) return builder.findMany();
  return builder.paginate(parsed.page ?? 1, parsed.perPage ?? 20);
});
```

The paginated response carries `records` beside `total`, `page`, `perPage`, and `lastPage`. That is
everything a pager needs to render its controls.

## Populating relations

`populate` replaces a relation's ids with the full related records, exactly as the fluent
[`populate`](../database/reading.md#populating-relations) does:

```
?populate=[author,tags]
```

An entry can be a spec object instead of a bare name. Its keys are relation fields, and each value
carries:

- `select` - which target fields come back. `UUID` comes back only when you name it.
- `populate` - the next level. Every level below uses the same grammar.

```
?populate=[{comments:{select:[text,author],populate:[{author:{select:[name]}}]}}]
```

- A spec carrying any key other than `select` and `populate` is a `400` with the code
  `invalidShape`.
- An empty `select` is `emptySelect` at its path.
- A populated relation must be named in its level's `select` when one is set, or it is left out
  without an error.

These [guards](#guards) limit depth and size:

- `maxPopulateDepth`, default `2`, so `comments.author` works with no setup. A deeper level lets a
  request reach more collections through a chain of relations, so raising it is a decision the
  endpoint makes explicitly.
- `maxPopulate`, default `20` nodes in total.

Through the shipped collection endpoints, a populated relation loads only what the caller may read,
as [across relations](#across-relations) describes.

## Locales

On a collection with [translatable fields](../database/translations.md), `locale` scopes the query
exactly as the fluent [`.locale()`](../database/reading.md#locales) does:

```
?locale=de&where={title:{isNull:true}}
```

- The tag must name a [configured content locale](../project/config.md#content-locales). Anything
  else is a `400` with the code `invalidLocale`.
- On a collection with nothing translatable, the parameter itself is a `400`, `localeNotApplicable`.
- Without it, the endpoint's [scope](#scoping-an-endpoint) decides. If the scope sets no locale, the
  default locale applies.

## Scoping an endpoint

The URL is untrusted, but your endpoint is not. `applyQuery` takes an optional scope. The request is
combined with that scope and can never go outside it. Parse against `scopedMetadata` so the fields
outside the scope are hidden from the URL as well:

```ts
const scope = { where: { published: true }, select: ['title', 'body', 'author'], limit: 100 };
const parsed = parseQueryParams(useSearchParams(), scopedMetadata(meta, scope), resolveGuards());
applyQuery(queryUntyped('Posts'), parsed, scope).findMany();
```

Now `GET /posts` only ever reads published posts, only the three named fields, and at most 100 rows,
whatever the URL asks for. The scope combines with the request by the rules
[the scope](./collections.md#the-scope) describes: `where` is added to every request with AND,
`select` narrows and hides, `limit` caps, and `locale` is only a default.

`applyQuery` and `applyScope` narrow `_translations` to the locales where the scope's `where`
allows the record, as the shipped [collection endpoints](./collections.md#reading) do.

When the scope's `where` reads a translatable field or a relation, `scopedMetadata` refuses a
request's filter on `_translations` as an `invalidField`. That filter reads every stored locale, so
it would reveal one the scope hides.

- `applyScope` applies the same scope to a builder when there is no query from a request to apply.
- To run your own query under a collection's guard and `access`, use
  [`queryScoped`](./collections.md#your-own-routes).
- The shipped collection endpoints take their scope from the operation's
  [`access`](./collections.md#access) option, so a collection declares the rule once and every
  endpoint applies it.

### Across relations

A `has` with conditions or a `populate` crosses into another collection. A bare `has` or `empty`
tests the parent's own link and never crosses.

`parseQueryParams` on its own crosses with no scope. Your endpoint scopes each crossed collection
through `parseWireQuery`. Its last argument is a function that takes a collection and returns a read
scope or `false`. Only that scope's `where` and `select` apply to a crossed read, not its `limit` or
`locale`.

The shipped collection endpoints cross only into what the caller could read from the target
directly:

- A target the caller cannot read matches nothing in a `has`. A
  [`record`](../database/field-types.md#record) that points to it populates as `null`, and a
  [`records`](../database/field-types.md#records) element from it is left out.
- A target's read scope narrows which of its rows match or populate, and which fields come back, at
  every level.
- A target field outside that scope is refused exactly as a field that does not exist.
- A `record` or `records` value you do not populate reads as stored, even when you cannot read its
  target. To keep those `UUID`s private, leave the field out of the read scope's `select` or mark it
  [`readable: false`](../database/collections.md#write-only-and-locked-fields).

## Reading from a POST body

A query that is too long for a URL can be sent as a JSON body in the same grammar. `readQueryBody`
reads it, and you pass the parsed object to the same `parseQueryParams`:

```ts
// api/posts/query.post.ts
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

- The body must be a JSON object sent as `application/json`. A `+json` suffix works too, and
  anything else is a `415`.
- The same top-level keys apply.
- A `maxDepth` option (default `32`) caps how deep the JSON may nest before it is refused.

The URL and the body parse to the same query, so a `GET` and its `POST` equivalent read the same
rows.

## Errors

A bad query throws a `400` that serializes to a small, stable shape:

```json
{
  "statusCode": 400,
  "message": "Unknown or unusable field `titel`. Did you mean `title`?",
  "data": { "code": "invalidField", "path": "where.titel" }
}
```

- `data.code` is a stable machine-readable string that your client code can check.
- `data.path` shows where the problem is in the query.

An unknown field and an operator a field does not support both give `invalidField`, so nobody can
use a URL to find out which fields your collection has. The full list of codes is the
`WireErrorCode` type, which you can import from `ohnejs`.

## Guards

The untrusted path has upper limits, so a hostile URL cannot overload the server. Each ceiling is a
`QueryGuards` field. Its default is high enough that a real query never comes near it:

| Guard              | Default | Caps                                                                                           |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `maxConditions`    | `100`   | Comparisons in one `where`, `has` and `empty` included.                                        |
| `maxHasDepth`      | `8`     | How deep `has` nests.                                                                          |
| `maxInLength`      | `2000`  | Elements in an `in`, `includesAll`, or `includesAny` list.                                     |
| `maxBoundParams`   | `10000` | Parameters one query binds, capped at the database's own limit.                                |
| `maxSelect`        | `200`   | Fields one `select` names.                                                                     |
| `maxOrder`         | `10`    | Keys in one `order`.                                                                           |
| `maxPopulate`      | `20`    | Nodes in one `populate` tree.                                                                  |
| `maxPopulateDepth` | `2`     | How deep `populate` nests.                                                                     |
| `maxValueBytes`    | `4096`  | Bytes in one string value.                                                                     |
| `maxPatternBytes`  | `512`   | Bytes in a `like` pattern, or a `contains`, `startsWith`, or `endsWith` pattern once it folds. |
| `maxLimit`         | `2000`  | The largest `limit`, and the default. A larger one is lowered to it.                           |
| `maxPerPage`       | `500`   | The largest `perPage`. A larger one is lowered to it.                                          |

The fluent builder is trusted and never checked.

To change a ceiling:

- App-wide, set it under `query.guards` in [`ohne.config.ts`](../project/config.md#query-guards).
- For one endpoint, pass it to `resolveGuards`:

```ts
// api/posts.get.ts
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
  const guards = resolveGuards({ maxPopulateDepth: 3 });
  const parsed = parseQueryParams(useSearchParams(), queryMetadata('Posts'), guards);
  return applyQuery(queryUntyped('Posts'), parsed).findMany();
});
```

Only the ceiling changes. Above it, `perPage` and `limit` are still lowered to their ceilings, and
everything else is still a `400` with the same code.
