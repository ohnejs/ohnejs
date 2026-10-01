# Reading records

`query` opens a typed builder over a collection and reads its records. Every field name, operator,
and returned row is typed from your schema, so a typo or a wrong-typed value is a compile error,
not a runtime surprise.

```ts
import { query } from 'ohnejs';

const posts = await query('Posts').findMany();
```

`findMany` returns every record as a full object: your fields, plus the `UUID` primary key, the
`_updatedAt` timestamp, and on a [translatable](./translations.md#reading) collection the
`_translations` locale list. `findFirst` returns the first match or `undefined`. On a
[singleton](./collections.md#singletons) it returns the one record.

```ts
const post = await query('Posts').findFirst();
```

The fields come from your [collections](./collections.md). The same grammar is available
[over HTTP](../api/url-queries.md).

## Filtering

`where` narrows the read. The short form takes a field and a value, and matches records where the
field equals that value:

```ts
await query('Posts').where('status', 'published').findMany();
```

The value is typed to the field, so passing a number to a text field is a compile error.

For anything other than equality, pass a callback. It receives a builder with exactly the operators
that field allows:

```ts
await query('Posts')
  .where('views', (w) => w.atLeast(100))
  .where('title', (w) => w.contains('ohne'))
  .findMany();
```

| Operators                                      | Fields                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equalsTo`, `in`                               | Text and number columns                                                                                                                                                   |
| `greaterThan`, `atLeast`, `lessThan`, `atMost` | Text and number columns                                                                                                                                                   |
| `contains`, `startsWith`, `endsWith`, `like`   | Text columns                                                                                                                                                              |
| `includes`, `includesAll`, `includesAny`       | [`multiSelect`](./field-types.md#multiselect), a [custom field type](./custom-field-types.md#storage) marked `jsonList`, and [`_translations`](./translations.md#reading) |
| `includes`, `includesAny`                      | [`records`](#filtering-relations), by the linked record's `UUID`                                                                                                          |
| `isNull`                                       | [Nullable fields](#null)                                                                                                                                                  |
| `has`, `empty`                                 | [Relations](#filtering-relations), [`object`](./field-types.md#object), [`repeater`](./field-types.md#repeater), and [blocks](#blocks)                                    |

An operator the field does not allow, like ordering on a boolean or `contains` on a number, does not
compile.

`contains`, `startsWith`, and `endsWith` ignore case in every script, so `contains('émile')` finds
`Émile`. Accents still count: `cafe` does not find `Café`.

Chained `where` calls are combined with AND. Each returns the builder, so you keep filtering.

### Negation

`not` negates the next operator. You write it as its own step before the operator, never as part of
the operator's name:

```ts
await query('Posts').where('status', (w) => w.not.equalsTo('draft')).findMany();
```

### Null

`null` is never a value to compare against. A nullable field allows `isNull`, the only null test,
and `equalsTo(null)` does not compile:

```ts
await query('Posts').where('summary', (w) => w.isNull()).findMany();
```

### Or on one field

After an operator, `or` starts an alternative on the same field. The record matches when either
comparison matches:

```ts
await query('Posts').where('views', (w) => w.atLeast(100).or.equalsTo(0)).findMany();
```

### Either-or

`where` clauses combine with AND. For an OR, `whereAny` opens a group of branches, and a record
matches when any branch matches. Chaining `where` on one branch combines with AND inside that
branch.

```ts
await query('Posts')
  .whereAny((q) => [
    q.where('featured', true),
    q.where('views', (w) => w.atLeast(1000)),
  ])
  .findMany();
```

A `whereAny` combines with the rest of the query using AND, so you can read "published, and either
featured or popular" by placing it after a `where`.

## Filtering relations

A [`record`](./field-types.md#record) or [`records`](./field-types.md#records) field relates to
another collection. `has` filters by the related rows. Its callback filters on the target
collection's fields:

```ts
await query('Posts')
  .where('author', (w) => w.has((a) => a.where('name', 'Anduin')))
  .findMany();
```

`has()` with no argument tests that the relation is set at all, and `empty()` is its opposite:

```ts
await query('Posts').where('author', (w) => w.has()).findMany();
await query('Posts').where('tags', (w) => w.empty()).findMany();
```

An [`object` or `repeater`](./collections.md#composite-fields) field takes the same pair. `has()`
with no argument tests that it holds anything, `empty()` tests the opposite, and a callback filters
on the composite's subfields.

A `records` field also takes `includes` and `includesAny`. They match by the linked record's
`UUID`, without reading the linked record itself:

```ts
const news = await query('Tags').where('label', 'News').findFirst();
if (news) await query('Posts').where('tags', (w) => w.includes(news.UUID)).findMany();
```

## Populating relations

By default a relation field is returned as `UUID`s: the id of the related row, or an array of them.
`populate` replaces those ids with the full related records:

```ts
const posts = await query('Posts').populate('author', 'tags').findMany();

posts[0].author; // the full author record, or null
posts[0].tags;   // an array of full tag records
```

Pass a callback to shape the related records. `select` keeps the fields you name, and `populate`
goes one level deeper, with the same grammar at every depth:

```ts
const posts = await query('Posts')
  .select('title', 'comments')
  .populate('comments', (c) =>
    c.select('text', 'author').populate('author', (a) => a.select('name')),
  )
  .findMany();

posts[0].comments[0].author; // { name: '...' }, or null
```

The row types match exactly what you wrote in the callback, at every depth. A populated level has
exactly the fields its `select` names. It includes `UUID` and `_updatedAt` only when you name them.

- When a level has a `select`, a populated relation must be named in it, or it is silently left out.
  Populate narrows a read and never widens one.
- A field can be populated once per level. Repeating the name alone is fine, but repeating it with a
  callback or a spec object like `{ author: { select: ['name'] } }` is an error.

Each level loads in one batched read, so a deep populate costs one query per relation, not one per
row. Parents that link to the same row share one object, so do not mutate a populated record.

## Blocks

A [`blocks`](./field-types.md#blocks) field filters with the same `has` and `empty`, with one extra
step: `has` names the block type first, and then a callback filters on its fields.

```ts
await query('Pages')
  .where('content', (w) => w.has('Hero', (h) => h.where('title', 'Launch')))
  .findMany();
```

The [blocks guide](./blocks.md#querying) covers these two steps and how to combine conditions across
block types.

## Ordering

`orderBy` sorts by a field. An optional second argument gives the direction, defaulting to
ascending. Call it again to add a second field, used when rows have the same value in the first:

```ts
await query('Posts').orderBy('publishedAt', 'desc').orderBy('title').findMany();
```

Rows that are still equal are always sorted by `UUID` last, so a paginated read never reorders rows
between pages.

## Selecting fields

By default a read returns every field. `select` narrows it to the ones you name, and the returned
type carries only those:

```ts
const rows = await query('Posts').select('title', 'views').findMany();

rows[0].title;  // string
rows[0].views;  // number
rows[0].author; // error: not selected
```

- Each `select` call adds to the ones before it.
- A [write-only field](./collections.md#write-only-and-locked-fields) is never returned unless your
  `select` names it explicitly.
- `_translations` can be selected and [filtered](./translations.md#reading), but not ordered by.

## Pagination

`paginate` reads one page and its totals in a single call:

```ts
const page = await query('Posts').orderBy('publishedAt', 'desc').paginate(1, 20);

page.records;  // the rows on this page
page.total;    // matching rows across every page
page.lastPage; // the number of the last page
```

`limit` and `offset` are the lower-level pair when you want a window of rows without the totals.

## Counting and checking

`count` returns how many records match, and `exists` returns whether any do. Both ignore ordering
and the row window:

```ts
const total = await query('Posts').where('status', 'published').count();
const any = await query('Posts').where('featured', true).exists();
```

`pluck` reads one field's value from each record a `findMany` would return, with the query's order
and window applied:

```ts
const titles = await query('Posts').pluck('title'); // string[]
```

Plucking a populated relation field returns the full related records, exactly as a full read would.

## Locales

A collection with [translatable fields](./translations.md#reading) reads one locale per query.
`.locale()` picks it, and the configured default applies without it:

```ts
const german = await query('Posts').locale('de').findMany();
```
