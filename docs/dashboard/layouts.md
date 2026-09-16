# Field layouts

A layout groups a form's fields: two on one line, a card around related ones, tabs for the long
tail. Declare it beside the fields, and the dashboard renders it wherever that form appears.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  dashboard: {
    layout: [
      { row: ['title', 'slug | 40%'] },
      'body',
      { card: { label: 'SEO', fields: [{ row: ['metaTitle', 'metaDescription'] }] } },
    ],
  },
  fields: {
    title: field('text'),
    slug: field('text'),
    body: field('text', { multiline: true }),
    metaTitle: field('text', { nullable: true }),
    metaDescription: field('text', { nullable: true }),
  },
});
```

- A field the layout does not name renders after it, so a layout never hides data.
- Every name must be a declared field, named once. An unknown or repeated name fails at boot.

## Fields and widths

A string names a field. After a `|`, a width caps it:

```ts
layout: ['title', 'price | 8rem', 'slug | 40%', 'published | auto']
```

- A CSS length or percentage is the most the field grows to.
- `auto` sizes the field to its content, for a checkbox or a button group beside a wide input.

## Rows

`row` puts fields, cards, or tabs side by side. They share the width, each shrinking equally
unless a width caps it:

```ts
layout: [
  { row: ['firstName', 'lastName'] },
  { row: ['status | 10rem', 'featured | auto', 'summary'] },
]
```

A row cannot hold another row or a rule. Under 480 pixels it stacks its entries.

## Cards

`card` draws a bordered group. The shorthand is the list of nodes. The object form adds a header:

```ts
layout: [
  { card: ['comments', 'assignee'] },
  { card: { label: 'app.posts.publishing', collapsible: true, fields: ['publishedAt', 'notes'] } },
]
```

- `label` is a plain string or a [message key](../i18n/messages.md). Without one, the card has no
  header.
- `collapsible: true` adds a toggle that shows on hover. A collapsed card whose fields carry errors
  turns its border destructive.

## Tabs

`tabs` splits fields over panels. The first tab opens active:

```ts
layout: [
  {
    tabs: [
      { label: 'app.posts.content', fields: ['body', 'excerpt'] },
      { label: 'SEO', fields: [{ row: ['metaTitle', 'metaDescription'] }] },
    ],
  },
]
```

- Every panel is built at once, so switching keeps what the user typed and undo works across tabs.
- A tab counts the errors its fields carry beside its label. A failed save opens the tab holding
  the first error, and a `#field-name` link opens the tab holding that field.

## Rules

`'---'` draws a line between stacked nodes:

```ts
layout: ['title', 'body', '---', 'notes']
```

## Where layouts apply

- A collection's record editor, through
  [`dashboard.layout`](../database/collections.md#the-collection-in-the-dashboard), for creating
  and editing alike.
- A [block](../database/blocks.md#naming-a-block), through `dashboard.layout` on `defineBlock`.
- An [`object` or `repeater`](../database/collections.md#composite-fields), through its `layout`
  option over its own subfields.
- The [account page](./account.md#extending-the-page), through the `auth:account-layout` hook.

A field the editor does not show, like a write-only field for a viewer who cannot write, drops out
with any row, card, or tab it leaves empty.
