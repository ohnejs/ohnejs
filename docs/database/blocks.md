# Blocks

A block is a reusable content shape - a hero, a quote, a gallery. A `blocks` field holds an
ordered list of them, mixed freely: where a repeater repeats one shape, blocks let each item be a
different one. Reach for them when content is built from varied sections in one editable order - a
page body, a landing layout, an article with embeds between paragraphs.

```ts
// blocks/Hero.ts
import { defineBlock, field } from 'ohne';

export default defineBlock({
  fields: {
    title: field('text'),
    subtitle: field('text', { nullable: true }),
  },
});
```

```ts
// collections/Pages.ts
import { defineCollection, field } from 'ohne';

export default defineCollection({
  fields: {
    title: field('text'),
    content: field('blocks', { allow: ['Hero', 'Quote'] }),
  },
});
```

A read returns `content` as a list of items, each naming its type.

## Defining a block

A block lives in one file under `blocks/` - each layer's `dirs.blocks` directory, set in
[config](../project/config.md) - and the file names it: `blocks/Quote.ts` defines `Quote`. Its
fields are ordinary `field(...)` instances - columns, relations, composites, to any depth.

```ts
// blocks/Quote.ts
import { defineBlock, field } from 'ohne';

export default defineBlock({
  fields: {
    text: field('text'),
    attribution: field('text', { nullable: true }),
  },
});
```

A block with no fields is legal - a divider is all type, no data.

## Naming a block

The dashboard names a block by sentence-casing it, so `PricingCard` reads as `Pricing card`. Give
it a `label` to say it differently, or to say it in every language you ship:

```ts
// blocks/PricingCard.ts
import { defineBlock, field } from 'ohne';

export default defineBlock({
  label: 'blocks.pricingCard.label',
  fields: {
    heading: field('text'),
    price: field('integer'),
  },
});
```

A plain string shows as written. A message key resolves per the viewer's language, so the label
lives in your catalogs with the rest of your UI strings - see [messages](../i18n/messages.md).

Blocks are global. Every `Quote` instance, whichever collection holds it, lives in one shared
table - so a `unique` field inside a block is unique across every instance in the database. And
`block` is a reserved field name inside a block: it is the key that names the type beside the
fields, everywhere a block appears.

## The blocks field

`allow` names the types the field may hold. Omit it to accept every block the app defines - an
open set, so a block a layer adds later joins it silently. Naming a block that no layer defines
fails at codegen.

```ts
fields: {
  content: field('blocks', { allow: ['Hero', 'Quote'] }),
}
```

The list defaults to `[]` when the input omits it. `allowEmpty: false` rejects a provided empty
list, demanding at least one block whenever the field is given at all.

A `translatable` blocks field keeps one list per locale, exactly as other translatable lists do,
and `deleteTranslation` removes one locale's blocks with the rest of its values. See
[translations](./translations.md).

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

`UUID` is the block instance's identity, stable across writes - the handle an update uses to keep
an item (below).

`select` may name a blocks field like any other. `orderBy` and `populate` do not accept one: a
list of mixed shapes has no sort key, and its items arrive in full already.

## Querying

A blocks field filters with the same `has`/`empty` pair a relation does. Bare `has()` matches
records whose list holds anything; `empty()` matches the empty list:

```ts
await query('Pages').where('content', (w) => w.has()).findMany();
await query('Pages').where('content', (w) => w.empty()).findMany();
```

To look inside, `has` takes the block type first - the list mixes shapes, so the type decides
which fields the probe may touch:

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

The callback form does not exist without the type: a probe that names no block is a compile
error, not a runtime surprise.

"Has a Hero matching this, or a Quote matching that" composes at the query level, one `has` per
branch:

```ts
await query('Pages')
  .whereAny((q) => [
    q.where('content', (w) => w.has('Hero', (h) => h.where('title', 'Launch'))),
    q.where('content', (w) => w.has('Quote', (h) => h.where('attribution', 'Rams'))),
  ])
  .findMany();
```

Over HTTP the same probe is a condition object whose `has` scope opens with a `block` equality;
see [querying over HTTP](../api/url-queries.md#filtering).

## Writing

`create` takes each item as an envelope: `block` names the type, `fields` a complete item of that
type's input shape.

```ts
await query('Pages').create({
  title: 'Home',
  content: [
    { block: 'Hero', fields: { title: 'Welcome' } },
    { block: 'Quote', fields: { text: 'Less, but better.', attribution: 'Rams' } },
  ],
});
```

An update replaces the list, exactly as a repeater does. Give an item its `UUID` to keep it - the
instance survives, rewritten to the fields you pass. Omit the `UUID` to insert a fresh block. An
item you leave out is deleted, and the positions renumber to your order, so reordering is just
reordering the array.

```ts
await query('Pages').where('UUID', id).update({
  content: [
    { block: 'Quote', UUID: quote.UUID, fields: { text: 'Kept, edited.', attribution: 'Rams' } },
    { block: 'Hero', fields: { title: 'Brand new' } },
  ],
}); // any block you did not list is deleted
```

An item's type is fixed: a kept `UUID` must keep its `block`, and turning a Hero into a Quote
means dropping the `UUID` - a new instance. A `UUID` from another record, or from another locale's
list, is an `invalidReference` error, never a silent adoption.

An empty list clears the field:

```ts
await query('Pages').where('UUID', id).update({ content: [] });
```

A removed block is removed fully - its instance and everything nested inside it - and so are a
record's blocks when the record itself is deleted. Nothing lingers.

A validation failure inside a block is keyed by its path through the envelope:
`content[1].fields.text`.

## Nesting

A block's fields may nest composites - and further blocks. A repeater inside a block, a blocks
field inside that: every level reads and writes through the same shapes.

```ts
// blocks/Columns.ts
import { defineBlock, field } from 'ohne';

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

Inside a block, an omitted `allow` includes the enclosing block itself, so a layout block can nest
its own kind without limit.
