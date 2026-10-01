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

Each word you type must match one of a record's fields, in any letter case. Each field type decides
how a word matches it:

- Text fields match anywhere inside, so `bring` finds Ashbringer.
- A select matches by its choice labels as you see them, so `progress` finds the status
  "In progress".
- A date matches the start of its `YYYY-MM-DD` form: `2026`, `2026-03` or `2026-03-14`.
- Number fields are skipped unless they ask to be searched.

Each field can switch search on or off, and so can a whole collection. See
[Search](../database/collections.md#search) for both switches.

Paste a record's `UUID` to find that record. A `UUID` inside an object, repeater, or block item finds
the record that holds it. A `UUID` finds its record even when the switches keep that collection or
field out of word search. It also lists the records that use it, see
[Where a record is used](#where-a-record-is-used).

- A collection takes part in word search when you may read it and it has a label: its
  `recordLabel`, or else its first text field. A singleton, or a collection without a label, takes
  part only for a pasted `UUID`.
- The search reads as the collection's own list read, so its
  [access rules](../api/collections.md#access) and read middleware apply. A field outside your
  read scope is never searched.
- Fields inside a record's own objects, repeaters, and blocks are searched too. A linked record
  counts only by its label, see [Related records](#related-records).
- A translatable collection is searched in your content language, the one you set on your account.
- A collection with very many fields searches only as many as the query limits allow, its label
  fields first.
- A collection that refuses the read is skipped, never an error.
- Records whose label fields hold every word come first.
- Records are searched from the second character you type. A single character only filters the
  pages.
- Each collection shows its five newest matches. "Load more" under it shows the next five.
- Quotes keep a phrase together: `"new york"` is one word.
- Punctuation around a word, a lone letter, and a repeated word are ignored, and only the first ten
  words count.
- A query starting with `/` is a command for a layer's own rows, like the assistant's skills, and
  searches nothing.

## Related records

A record is also found through a record it links to. Say each person links a portrait:

```ts
// collections/People.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  api: { read: true },
  dashboard: { recordLabel: 'name' },
  fields: {
    name: field('text'),
    portrait: field('record', { collection: 'Uploads' }),
  },
});
```

Typing `ceo` lists the people whose portrait is named `ceo-portrait.webp`, under "People via
Uploads". Related groups come after the records that match on their own and the pages. Each row
shows the linked record that matched at its end. Hover it to see the field that links it:
"Portrait" here, or a path like "Body > Hero > Image" for a link inside blocks.

- Each word matches the record's own fields or the label of a record it links to. So the words can
  split across the link: `benno ceo` finds Benno, whose portrait matches `ceo`.
- A list relation can match each word through a different record: one image for `offsite`, another
  for `keynote`.
- Links inside objects, repeaters, and blocks count too, like a block's image in a page's body.
- Only the linked record's label fields match, and only those with search on.
- A record that matches on its own never shows again as related.
- In a collection with very many text fields, words split across a link may not fit the query
  limits. Words that all match on one side still find the record.
- A relation with `search: false` is never followed, and neither is the inverse side of a `records`
  relation. [A collection in search](../database/collections.md#a-collection-in-search) shows how to
  keep a whole collection from being followed.
- Each related group shows its five newest records, and "Load more" shows the next five. A common
  word can link through many collections, so only the first eight related groups show, and a line
  under the results says so. Add a word to narrow it down.

## Where a record is used

Paste a record's `UUID` to find the record, then every record that links to it. They show as
related records: a page using an upload as its cover shows under "Pages via Uploads".

A link counts even through a relation with `search: false`, or into a collection kept out of word
search. Keep in mind what the list can and cannot tell you:

- It lists only the records you can open. Records hidden from you are not listed.
- A link stored only in another language shows after you switch your content language.
- It is not a delete guard. A record with no usage here may still be linked from a record you cannot
  open.

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

A related result also carries `via`: the collection it was found through, and each linked record
that matched, with the path of the relation field that links it:

```ts
// { collection: 'People', UUID: '...', label: 'Benno Quade', via: {
//   collection: 'Uploads',
//   targets: [{ UUID: '...', label: 'ceo-portrait.webp', path: 'portrait' }],
// } }
```

- `limit` caps the records per collection and per related group, up to 50. Omitted, each answers
  five.
- `collection` searches that one alone, and `offset` skips its first matches, to page through it.
  An unknown `collection` answers no results, and paging stops past an `offset` of 1000.
- `via` beside `collection` pages that collection's records found through `via` instead. An unknown
  `via`, or one the collection never links to, answers no results.
- `truncated: true` on the answer means some related groups were left out.
- `label` is `''` when a record's label fields are empty.
- The route needs a signed-in user; a guest gets `401`.

With the [assistant](../ai/assistant.md) installed, the last row asks it your question instead, and so
does Tab, whatever row is selected.
