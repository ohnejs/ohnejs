# Blocks

A block is a reusable content shape, like a section of a website page: a hero, a quote, a gallery.
A `blocks` field holds an ordered list of them, mixed freely. A
[repeater](./collections.md#composite-fields) repeats one shape, but blocks let each item be a
different one.

Use them when content is built from different sections in an order the editor chooses: a page body,
a landing page, an article with embeds between paragraphs.

```ts
// blocks/Hero.ts
import { defineBlock, field } from 'ohnejs';

export default defineBlock({
  fields: {
    title: field('text'),
    subtitle: field('text', { nullable: true }),
  },
});
```

```ts
// collections/Pages.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    content: field('blocks', { allow: ['Hero', 'Quote'] }),
  },
});
```

A read returns `content` as a list of items, each naming its type.

## Defining a block

A block lives in one file under `blocks/`, which is each layer's `dirs.blocks` directory, set in
[config](../project/config.md#directories). The file names the block: `blocks/Quote.ts` defines
`Quote`. Its fields are ordinary [`field(...)` instances](./collections.md) - columns, relations,
composites, to any depth.

```ts
// blocks/Quote.ts
import { defineBlock, field } from 'ohnejs';

export default defineBlock({
  fields: {
    text: field('text'),
    attribution: field('text', { nullable: true }),
  },
});
```

A block can have no fields. A divider, for example, has a type but no data.

Blocks are global. Every `Quote` instance lives in one shared table, no matter which collection
holds it:

- A `unique` field inside a block is unique across every instance in the database.
- `block` is a reserved field name inside a block. A [filter](#querying) names the block type
  with a `block` key beside the block's own fields, so a field of that name would clash.

## Naming a block

The dashboard names a block by sentence-casing it, so `PricingCard` reads as `Pricing card`. Give
it a `label` to use a different name, or to translate the name into every language you ship:

```ts
// blocks/PricingCard.ts
import { defineBlock, field } from 'ohnejs';

export default defineBlock({
  label: 'blocks.pricingCard.label',
  fields: {
    heading: field('text'),
    price: field('integer'),
  },
});
```

A plain string shows as written. A message key is replaced by its text in the viewer's language, so
the label lives in your [catalogs](../i18n/messages.md#catalogs) with the rest of your UI strings.

A block also takes a `dashboard.layout`, the same [field layout](../dashboard/layouts.md) a
collection declares, to arrange its fields in the editor.

## The blocks field

`allow` names the types the field may hold. Omit it to accept every block the app defines. That is
an open set, so a block that a layer adds later joins it silently. Naming a block that no layer
defines fails at codegen.

```ts
fields: {
  content: field('blocks', { allow: ['Hero', 'Quote'] }),
}
```

- `allowEmpty: false` requires at least one block when the field is given.
- A [`translatable`](./translations.md#marking-fields) blocks field keeps one list per locale, and
  [`deleteTranslation`](./translations.md#deleting-translations) removes one locale's blocks with
  the rest of its values.

## Reading

Each item is an envelope: `block` names the type, `UUID` identifies the item, and `fields` carries
the block's own values.

```ts
const page = await query('Pages').findFirst();

page.content;
// [
//   { block: 'Hero', UUID: '019...', fields: { title: 'Welcome', subtitle: null } },
//   { block: 'Quote', UUID: '019...', fields: { text: 'Less, but better.', attribution: 'Rams' } },
// ]
```

The items are a discriminated union, so checking `block` narrows `fields` to that type's shape:

```ts
for (const item of page.content) {
  if (item.block === 'Hero') {
    item.fields.title; // string - the Hero shape
  }
}
```

[`select`](./queries.md#selecting-fields) may name a blocks field like any other. `orderBy` and
`populate` do not accept one: a list of mixed shapes has no sort key, and its items arrive in full
already.

## Querying

You filter a blocks field with the same [`has` and `empty`](./queries.md#filtering-relations) as a
relation. Bare `has()` matches records whose list holds anything, and `empty()` matches the empty
list:

```ts
await query('Pages').where('content', (w) => w.has()).findMany();
await query('Pages').where('content', (w) => w.empty()).findMany();
```

To look inside, `has` takes the block type first. The list mixes shapes, so the type decides which
fields the probe may touch, and a probe that names no block is a compile error:

```ts
// has a Hero at all
await query('Pages')
  .where('content', (w) => w.has('Hero'))
  .findMany();

// has a Hero whose title matches
await query('Pages')
  .where('content', (w) => w.has('Hero', (h) => h.where('title', (t) => t.contains('launch'))))
  .findMany();
```

To match "has a Hero matching this, or a Quote matching that", combine the conditions at the query
level, one `has` per branch:

```ts
await query('Pages')
  .whereAny((q) => [
    q.where('content', (w) => w.has('Hero', (h) => h.where('title', 'Launch'))),
    q.where('content', (w) => w.has('Quote', (h) => h.where('attribution', 'Rams'))),
  ])
  .findMany();
```

[Over HTTP](../api/url-queries.md#filtering), the same probe is a condition object whose `has`
scope starts with a `block` equality.

## Writing

`create` takes each item as an envelope: `block` names the type, and `fields` holds a complete item
of that type's input shape.

```ts
await query('Pages').create({
  title: 'Home',
  content: [
    { block: 'Hero', fields: { title: 'Welcome' } },
    { block: 'Quote', fields: { text: 'Less, but better.', attribution: 'Rams' } },
  ],
});
```

An update replaces the list the way a [repeater does](./writing.md#lists-on-update):

- Give an item its `UUID` to keep it and rewrite it with the fields you pass.
- Omit the `UUID` to insert a new block.
- Leave an item out to delete it.

Positions follow your array, so reordering is just reordering the array.

```ts
await query('Pages').where('UUID', id).update({
  content: [
    { block: 'Quote', UUID: quote.UUID, fields: { text: 'Kept, edited.', attribution: 'Rams' } },
    { block: 'Hero', fields: { title: 'Brand new' } },
  ],
}); // any block you did not list is deleted
```

An item's type is fixed. A kept `UUID` must keep its `block`, so to turn a Hero into a Quote, omit
the `UUID` and create a new instance. A `UUID` from another record, or from another locale's list,
is an `invalidReference` error. The item is never silently moved into this list.

An empty list clears the field:

```ts
await query('Pages').where('UUID', id).update({ content: [] });
```

A removed block is removed completely, with everything nested inside it. The same happens to a
record's blocks when the record itself is deleted.

A [validation failure](./writing.md#the-result) inside a block is keyed by its path through the
envelope: `content[1].fields.text`.

## Nesting

A block's fields may nest composites, and more blocks too. You can put a repeater inside a block,
and a blocks field inside that repeater. Every level reads and writes through the same shapes.

```ts
// blocks/Columns.ts
import { defineBlock, field } from 'ohnejs';

export default defineBlock({
  fields: {
    heading: field('text'),
    columns: field('repeater', {
      fields: {
        width: field('integer'),
        content: field('blocks', { allow: ['Hero', 'Quote'] }),
      },
    }),
  },
});
```

Inside a block, an omitted `allow` includes the block that holds the field, so a layout block can
nest blocks of its own type without limit.
