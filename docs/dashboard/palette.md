# Search palette

Press Cmd+K (Ctrl+K on Windows and Linux) on any dashboard page to open the palette. Type to find
records across every collection you can read, or to jump to a page from the sidebar. Arrow keys
move the selection, Enter opens it, Escape closes the palette.

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

## What is searched

Each word you type must appear, in any letter case, in one of a record's text fields. Above, `name`
and `tooltip` are searched; an `integer` field never is.

- A collection takes part when you may read it and it has a label: its `recordLabel`, or else its
  first text field. A singleton never does.
- The search reads as the collection's own list read, so its
  [access rules](../api/collections.md#access) and read middleware apply. A field outside your
  read scope is never searched.
- A collection that refuses the read is skipped, never an error.
- Records whose label holds every word come first.
- Only the first ten words count.

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
- `label` is `''` when a record's label fields are empty.
- The route needs a signed-in user; a guest gets `401`.
