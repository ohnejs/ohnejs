# Search palette

Press Cmd+K (Ctrl+K on Windows and Linux) on any dashboard page, or click the search box in the
header, to open the palette. Type to find records across every collection you can read, or to jump
to a page from the sidebar. Arrow keys move the selection and Enter opens it. Escape steps back to
a blank search, then closes the palette; opening it again picks up where you left it.

A record shows under its collection by its label, so give each collection one:

```ts
// collections/Items.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  api: { read: true },
  dashboard: { recordLabel: 'name' },
  fields: {
    name: field('text'),
    tooltip: field('text', { nullable: true }),
  },
});
```

Typing `ashbringer` now lists the item named Ashbringer, and any item whose tooltip mentions it.
Picking a record opens its editor, or the page its collection's
[`recordPath`](../database/collections.md#the-collection-in-the-dashboard) names.

## What is searched

Each word you type must appear, in any letter case, in one of a record's text fields. Above, `name`
and `tooltip` are searched; an `integer` field never is.

- A collection takes part when you may read it and it has a label: its `recordLabel`, or else its
  first text field. A singleton never does.
- The search reads as the collection's own list read, so its
  [access rules](../api/collections.md#access) and read middleware apply. A field outside your
  read scope is never searched.
- Text inside a record's own objects, repeaters, and blocks is searched too. A related record's text
  is not.
- A collection with very many text fields searches only as many as the query limits allow, the
  record's own fields first.
- A collection that refuses the read is skipped, never an error.
- Records whose label holds every word come first.
- Each collection shows its five newest matches. "Load more" under it shows the next five.
- Only the first ten words count.
- A query starting with `/` is a command for a layer's own rows, like the assistant's skills, and
  searches nothing.

## Searching from your code

The palette asks `POST /search`, and so can your own pages:

```ts
const response = await api('POST /search', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ q: 'ashbringer', limit: 10 }),
});
const { results } = await response.json();
// [{ collection: 'Items', UUID: '...', label: 'Ashbringer' }]
```

- `limit` caps the records per collection. Omitted, each collection answers five.
- `collection` searches that one alone, and `offset` skips its first matches, to page through it.
- `label` is `''` when a record's label fields are empty.
- The route needs a signed-in user; a guest gets `401`.

With the [assistant](../ai/assistant.md) installed, the last row asks it your question instead, and so
does Tab, whatever row is selected.
