# Reading records

`query` opens a typed builder over a collection and reads its records. Every field name, operator,
and returned row is typed from your schema, so a typo or a wrong-typed value is a compile error,
not a runtime surprise.

```ts
import { query } from 'ohne';

const posts = await query('Posts').findMany();
```

`findMany` returns every record as a full object: your fields, plus the `UUID` primary key and the
`_updatedAt` timestamp. `findFirst` returns the first match or `undefined`.

```ts
const post = await query('Posts').findFirst();
```

The collection is defined in a file under `collections/`; see [collections](./collections.md) for
the field types and [schema sync](./sync.md) for how a collection becomes a table. The same query
grammar is available over HTTP too - see [querying over HTTP](../api/url-queries.md).

## Filtering

`where` narrows the read. The short form takes a field and a value, and matches on equality:

```ts
await query('Posts').where('status', 'published').findMany();
```

The value is typed to the field. Passing a number to a text field, or `null` to any field, is a
compile error - `null` is never a value, and `isNull` is the only null test (below).

For anything past equality, pass a callback. It receives a builder carrying exactly the operators
that field admits:

```ts
await query('Posts')
  .where('views', (w) => w.atLeast(100))
  .where('title', (w) => w.contains('ohne'))
  .findMany();
```

Which operators appear depends on the field's type. A text column offers `contains`,
`startsWith`, `endsWith`, and the raw `like`; text and number columns alike admit the ordering
comparisons `greaterThan`, `atLeast`, `lessThan`, and `atMost`; both offer `equalsTo` and `in`.
Asking for an operator the field does not admit - ordering on a boolean, `contains` on a number -
does not compile.

Chained `where` calls AND together. Each returns the builder, so you keep filtering.

### Negation

`not` negates the next operator. It reads as a namespace, never a suffixed operator name:

```ts
await query('Posts').where('status', (w) => w.not.equalsTo('draft')).findMany();
```

### Null

A nullable field admits `isNull`. It is the only way to test null - `equalsTo(null)` does not
compile:

```ts
await query('Posts').where('summary', (w) => w.isNull()).findMany();
```

### Or on one field

After an operator, `or` starts an alternative on the same field - the record matches when either
comparison does:

```ts
await query('Posts').where('views', (w) => w.atLeast(100).or.equalsTo(0)).findMany();
```

### Either-or

`where` clauses AND. For an OR, `whereAny` opens a group of branches; a record matches when any
branch matches. Chaining `where` on one branch ANDs within it.

```ts
await query('Posts')
  .whereAny((q) => [
    q.where('featured', true),
    q.where('views', (w) => w.atLeast(1000)),
  ])
  .findMany();
```

A `whereAny` ANDs onto the rest of the query, so you can read "published, and either featured or
popular" by placing it after a `where`.

## Relations

A `record` or `records` field relates to another collection. `has` filters by the related rows,
re-scoped to the target's fields:

```ts
await query('Posts')
  .where('author', (w) => w.has((a) => a.where('name', 'Ada')))
  .findMany();
```

Bare `has()` tests that the relation is set at all; `empty()` is its opposite:

```ts
await query('Posts').where('author', (w) => w.has()).findMany();
await query('Posts').where('tags', (w) => w.empty()).findMany();
```

An `object` or `repeater` field admits the same pair: bare `has()` tests it holds anything,
`empty()` the opposite, and a callback probes the composite's subfields.

By default a relation field reads back as `UUID`s - the id of the related row, or an array of them.
`populate` swaps those ids for the full related records:

```ts
const posts = await query('Posts').populate('author', 'tags').findMany();

posts[0].author; // the full author record, or null
posts[0].tags; // an array of full tag records
```

A callback narrows what the related records carry and populates their own relations. `select`
names the fields to keep - the records then carry exactly those, `UUID` and `_updatedAt` only
when named. `populate` descends one level further, with the same grammar at every depth:

```ts
const posts = await query('Posts')
  .select('title', 'comments')
  .populate('comments', (c) =>
    c.select('text', 'author').populate('author', (a) => a.select('name')),
  )
  .findMany();

posts[0].comments[0].author; // { name: '...' }, or null
```

The rows type exactly what the callback wrote, at every depth.

Two rules to know. A populated relation must be named in its level's `select` when one is set,
or it silently drops - populate narrows a read, it never widens one. And a field populates once
per level: repeating a bare name is fine, repeating it with a callback or spec is an error.

Each level loads in one batched read, so a deep populate costs one query per relation, not one
per row. The same rows are shared across the parents that link them, so do not mutate a
populated record.

## Blocks

A `blocks` field filters with the same `has`/`empty` pair, with one extra step: `has` names the
block type before a callback probes its fields.

```ts
await query('Pages')
  .where('content', (w) => w.has('Hero', (h) => h.where('title', 'Launch')))
  .findMany();
```

The [blocks guide](./blocks.md#querying) covers the two-step and composing across types.

## Ordering

`orderBy` sorts by a field. An optional second argument gives the direction, defaulting to
ascending; call it again to add a tiebreaker:

```ts
await query('Posts').orderBy('publishedAt', 'desc').orderBy('title').findMany();
```

Ties always resolve by `UUID` last, so a paginated read never reorders rows between pages.

## Selecting fields

By default a read returns every field. `select` narrows it to the ones you name, and the returned
type carries only those:

```ts
const rows = await query('Posts').select('title', 'views').findMany();

rows[0].title; // string
rows[0].views; // number
rows[0].author; // compile error: not selected
```

`select` accumulates across calls.

## Pagination

`paginate` reads one page and its totals in a single call:

```ts
const page = await query('Posts').orderBy('publishedAt', 'desc').paginate(1, 20);

page.records; // the rows on this page
page.total; // matching rows across every page
page.lastPage; // the number of the last page
```

`limit` and `offset` are the lower-level pair when you want a window without the totals.

## Counting and checking

`count` returns how many records match; `exists` returns whether any do. Both ignore ordering and
the row window:

```ts
const total = await query('Posts').where('status', 'published').count();
const any = await query('Posts').where('featured', true).exists();
```

`pluck` reads one field's value from each record a `findMany` would return - the query's order
and window apply:

```ts
const titles = await query('Posts').pluck('title'); // string[]
```

Plucking a populated relation field returns the hydrated records, exactly as a full read would.

## Locales

A collection with [translatable fields](./translations.md) reads one locale per query - `.locale()`
picks it, the configured default applies without it:

```ts
const german = await query('Posts').locale('de').findMany();
```
