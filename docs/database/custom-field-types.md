# Custom field types

A field type is the contract behind `field(...)`: how a value is stored, which options a field
takes, and how every write cleans and checks the value. Define your own when a value has rules that
you would otherwise repeat on every field that holds it: a slug, a color, a currency code.

```ts
// fields/slug.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'text',
  sanitizers: [(value) => value.trim().toLowerCase().replace(/\s+/g, '-')],
  validators: [
    (value) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
        ? undefined
        : 'Must be lowercase words joined by hyphens',
  ],
});
```

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    slug: field('slug', { unique: true }),
  },
});
```

Every `slug` field now cleans and checks its value the same way, in whichever collection declares
it.

## Where field types live

A field type lives in one file under `fields/`. That is each layer's `dirs.fields` directory, set in
[config](../project/config.md#directories). The file name gives the type its name: `fields/slug.ts`
defines `slug`, `fields/hex-color.ts` defines `hexColor`. Codegen registers every type, so once
[`ohne prepare`](../project/cli.md#ohne-prepare) or [`ohne dev`](../project/cli.md#ohne-dev) has
run, `field('slug')` autocompletes and its options type-check.

A file whose name starts with `_` is a helper that the scan skips, so code that your types share can
sit beside them.

A type in a closer [layer](../project/layers.md#what-overrides-what) replaces a further layer's
type of the same name, built-in types included.

## Options

`options` declares what a `field(...)` call may pass. You make each entry with `option()`. Your
callbacks read the resolved values from `ctx.options`:

```ts
// fields/handle.ts
import { defineField, option } from 'ohnejs';

export default defineField({
  columnType: 'text',
  options: {
    max: option({ default: 30 }),
  },
  validators: [(value, ctx) => (value.length > ctx.options.max ? 'Too long' : undefined)],
});
```

```ts
fields: {
  handle: field('handle', { max: 20 }),
}
```

- An option with a `default` is optional, and `ctx.options` always holds a value for it.
- An option with `required: true` must be passed, or the `field(...)` call does not type-check.
- An option with neither stays absent when omitted.

The value type comes from the default, widened to its primitive. Pass a generic to keep a union:

```ts
option<'soft' | 'hard'>({ default: 'soft' })
```

Option names are camelCase. None may reuse the name of an option that every field already takes,
like `nullable`, `default`, or `label`.

## Checking options

Some options only make sense together. A `rating` with `min: 5` and `max: 1` type-checks, but no
value could ever pass. `validateOptions` catches it at boot:

```ts
// fields/rating.ts
import { defineField, option } from 'ohnejs';

export default defineField({
  columnType: 'integer',
  options: {
    min: option({ default: 1 }),
    max: option({ default: 5 }),
  },
  validateOptions: ({ options }) =>
    options.min > options.max ? ['`min` is above `max`.', 'Swap them.'] : undefined,
});
```

Return `undefined` when the options are fine. Otherwise, return what is wrong and how to fix it, as
a string or a list of lines. Boot stops and shows those lines with the field they belong to.

Only you see these lines, never an editor, so write them as plain text rather than message keys.

For a `min` and `max` pair, `boundsProblem(options)` from `ohnejs` writes those lines for you, as the
built-in types do.

## Storage

`columnType` picks the column the value is stored in: `text`, `integer`, `real`, `boolean`, or
`json`. A write converts input to that type and rejects what does not fit before your code runs, so
the sanitizers and validators of a `text` type always receive a string.

A `json` column accepts any value, so its validators check the shape. Its value has the type
`unknown` unless `emitType` returns the TypeScript type as source code:

```ts
// fields/labels.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'json',
  jsonList: true,
  defaultValue: () => [],
  emitType: () => 'string[]',
  validators: [
    (value) =>
      Array.isArray(value) && value.every((label) => typeof label === 'string')
        ? undefined
        : 'Must be a list of labels',
  ],
});
```

`jsonList: true` marks a `json` value as a list, so a query can filter it with
[`includes`, `includesAll`, and `includesAny`](./reading.md#filtering). Neither the flag nor
`emitType` checks anything at runtime. Only the validators make sure the value has the shape its
type promises.

A `json` type whose value points at records of another collection lists them with `links`. Each
entry pairs a [record link](./rich-text.md#links) with its path inside the value, `''` for the
value itself:

```ts
// fields/related.ts
import { defineField } from 'ohnejs';
import { isRecordLink } from 'ohnejs/utils';

export default defineField({
  columnType: 'json',
  emitType: (ctx) => ctx.importType('ohnejs/utils', 'RecordLink'),
  validators: [(value) => (isRecordLink(value) ? undefined : 'Must link a record')],
  links: (value) => (isRecordLink(value) ? [{ path: '', link: value }] : []),
});
```

A write then [checks each listed link](./rich-text.md#checking-record-links) its input provides,
at the entry's path, and a delete of the target never cascades or blocks. The function may receive
an unvalidated value, so it returns `[]` for anything it cannot read.

`serialize` and `deserialize` convert between the value and what the column stores. `serialize`
runs after the validators, so they check the value before it is encoded. The `password` type hashes
its value there.

Set `copy: false` when the value a read returns is not valid write input. A
[duplicate](./writing.md#duplicating-records) or a
[copied translation](./translations.md#copying-a-translation) then leaves the field out. The
`password` type sets it, since its stored hash would be hashed again.

A type that references another collection, like the uploads layer's
[`image` and `images`](../uploads/fields.md), returns a storage layout from `schema` instead:

- `columnType: 'text'` with a `foreignKey`, for one reference.
- `columnType: false` with a `junction`, for a list.

The value type then follows from the layout, so such a type declares no `emitType`.

## Composite types

A type whose value is a fixed group of parts, like a date span, returns a child layout from
`schema`. It stores exactly as an [`object`](./field-types.md#object) does, so its value, its
filters, and its error paths work the same way:

```ts
// fields/span.ts
import { defineField, field } from 'ohnejs';

export default defineField({
  columnType: false,
  schema: () => ({
    kind: 'child',
    cardinality: 'one',
    subfields: { start: field('date'), end: field('date') },
    orderBy: 'start',
  }),
  validators: [
    (value) => {
      const span = value as { start: string; end: string } | null;
      return span === null || span.start <= span.end ? undefined : 'Must end after it starts';
    },
  ],
});
```

The validators receive the whole value. A field of this type filters through
[`has`](./reading.md#filtering-relations), like any object.

`orderBy` names the part a query sorts by when it orders by the field itself. A field
`period: field('span')` then sorts by its `start` in `orderBy('period')`. Without it, the field
cannot be ordered.

## On your website

A [website](../cms/website.md) that reads your pages through the CMS gets a types file made from
your schema. There, a field of your type has the type `emitType` returns, as long as the website can
resolve it: an inline type like `'string[]'`, or a link or rich text type from `ohnejs/utils`. Keep
a small shape inline in `emitType`, and your server and your website share one type.

`emitType` describes the value your code holds; `emitJSONType` describes how it reads as JSON, and
you need it only when `deserialize` makes the two differ:

```ts
// fields/instant.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'text',
  deserialize: (value) => new Date(value as string),
  emitType: () => 'Date | string',
  emitJSONType: () => 'string',
});
```

Your code reads a `Date`, and the website receives the string that `Date` turns into as JSON.

Declare `emitJSONType` too when `emitType` imports a type from your own files, since the website
cannot import them. Return the shape inline, like `'{ lat: number; lng: number }'`. A field that
the website cannot type reads `unknown` there, and generating the types warns about it.

A layer's type that lacks `emitJSONType` is yours to complete: a type of the same name in your app
[replaces it](#where-field-types-live), so spread the layer's type into it and add the hook.

## Defaults

`defaultValue` is what a create stores in the field's column when its input leaves the field out:

```ts
// fields/rating.ts
import { defineField } from 'ohnejs';

export default defineField({ columnType: 'integer', defaultValue: 0 });
```

Pass a value, or a callback that computes one from `ctx`: the field's `options`, the record's raw
`input`, and the `operation`. A field's own `default` replaces the type's, in the
[order writing records describes](./writing.md#defaults). A default runs through the type's
sanitizers and validators like any value, so it must be one they accept. A literal default that they
reject fails at boot. A callback default that they reject fails the create that computes it.

## Sanitizers and validators

Sanitizers clean a value before it is stored, and validators decide whether it may be stored at
all. A write runs the type's `sanitizers`, then its `validators`, each list in order:

```ts
sanitizers: [(value) => value.trim()],
validators: [
  (value, ctx) => (value === ctx.input.username ? 'Must differ from the username' : undefined),
],
```

- A sanitizer returns the cleaned value. It never rejects.
- A validator returns a message to reject the value, or `undefined` to accept it.
- The first message stops the field: no later validator runs.
- A message is a [message key](../i18n/messages.md#validation-messages), a `{ key, params }`
  object, or a plain string.
- `null` skips both lists: a nullable field's `null` is stored as it is.

Every function receives `ctx` as its second argument:

- `options` - the field's resolved options.
- `input` - the record's raw input, so a check can read another field's value as it was sent.
- `tx` - the open [transaction](./engine.md#transactions), so a check can query the database.

The type's lists run before the ones a field adds, in the
[order writing records describes](./writing.md#sanitizers-and-validators).

A returned message is reported under the field's own name. A type whose value has parts can report
an error for one part by writing into `ctx.errors`, with the sub-path as the key:

```ts
// fields/address.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'json',
  validators: [
    (value, ctx) => {
      const address = value as { city?: string };
      if (!address.city) ctx.errors.city = 'This value must not be empty';
    },
  ],
});
```

On a field named `address`, that failure is reported at `address.city`. A key that starts with `[`
is joined without a dot, so `ctx.errors['[2]']` on a field named `labels` is reported at
`labels[2]`.

## Search

`search` tells the [search palette](../dashboard/palette.md) how a typed word matches your type.
Without it, a `text` column matches any value that contains the word, and other columns match
nothing. A function turns each word into a condition on the field, or `null` when the word cannot
match:

```ts
// fields/sku.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'text',
  sanitizers: [(value) => value.toUpperCase()],
  search: ({ token }) =>
    /^[a-z]{2}-\d+$/i.test(token) ? { startsWith: token.toUpperCase() } : null,
});
```

Typing `ab-10` now finds `AB-1042`, and `hello` skips the field.

- `token` is one word as it was typed, or a quoted phrase. Normalize it the way your sanitizers
  normalize a stored value, as `toUpperCase` does above.
- The result is what you would write for the field in a [filter](./reading.md#filtering):
  `{ startsWith: ... }`, `{ in: [...] }`, or a plain value for equality. An operator the field does
  not accept fails the search.
- `ctx` also carries the field's `options`, and `resolveMessage`, which renders a
  [message](../i18n/messages.md) like a choice label in the language the search runs in.
- The function runs once per word and field, before the query, and never sees a record. The
  database does the matching.

The object form keeps the matcher but leaves each field off until it asks with `search: true`. It
suits a value most fields do not want searched, like a year:

```ts
// fields/year.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'integer',
  search: {
    default: false,
    match: ({ token }) => (/^\d{4}$/.test(token) ? { equalsTo: Number(token) } : null),
  },
});
```

```ts
// collections/Albums.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    released: field('year', { search: true }),
  },
});
```

`search: false` locks the type out instead: no field of it matches, and `search: true` on one fails
at boot. A type that stores its value through `schema` takes no function, because search follows a
relation or composite into what it holds.

The built-in types are exported from `ohnejs`, so a closer layer can override one and change only
how it is searched:

```ts
// fields/select.ts
import { defineField, select } from 'ohnejs';

export default defineField({ ...select, search: false });
```

## In the dashboard

A type with a `text`, `integer`, `real`, or `boolean` column and no `schema` is edited in the
dashboard like the matching built-in type, and you do not need to register anything. Any other type
shows a notice instead of its form control until a
[dashboard boot file](../dashboard/pages.md#boot-files) registers one with `registerFieldType`.
The registration names the type in `KnownFieldTypes` beside it, as
[typing a custom field type](../dashboard/forms.md#typing-a-custom-field-type) shows.
