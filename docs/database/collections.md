# Collections and fields

A collection is a set of fields, declared in one file under `collections/`. Each field becomes a
column, a relation, or a nested table. This guide covers the built-in field types -
[define your own](./field-types.md) when none fits; see [schema sync](./sync.md) for how a
collection file becomes a table, and [reading records](./queries.md) for querying them. Every
field also takes per-value options: `default`, `sanitizers`, and `validators` act at write time,
covered in [writing records](./writing.md); `when` activates a field per record, covered in
[conditional fields](./conditional-fields.md).

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    views: field('integer'),
    featured: field('boolean'),
  },
});
```

## Column fields

`text`, `integer`, `number`, and `boolean` are the plain column types. Each stores one value per
row. The choice and date-time types below store through the same columns, adding shape on top.

`integer` holds whole numbers within JavaScript's safe range. `number` holds finite decimals - an
IEEE 754 double, exactly what a JavaScript number is, so every stored value reads back unchanged.
`NaN` and the infinities are rejected.

For money, use `integer` minor units (cents), not `number`. A double cannot represent a decimal
tenth exactly, so float arithmetic drifts where currency must not.

A field is required unless you pass `nullable: true`, which lets the column hold `null`:

```ts
fields: {
  title: field('text'),
  summary: field('text', { nullable: true }),
}
```

A `text` field additionally rejects the empty string - `''` is not a value by default. Pass
`allowEmpty: true` to permit it.

`text`, `integer`, and `number` take `min` and `max` bounds. On `integer` and `number` they bound
the value; on `text` they bound the length in characters:

```ts
fields: {
  title: field('text', { min: 3, max: 120 }),
  rating: field('integer', { min: 1, max: 5 }),
}
```

`unique` and `index` cover single-column constraints; multi-column ones live on the collection.
Both are in [schema sync](./sync.md).

## Choice fields

`select` holds one value out of a list you declare. The generated record type narrows to exactly
that union, and a write outside the list rejects:

```ts
fields: {
  status: field('select', { choices: ['draft', 'published', 'archived'] }),
}
```

A choice may pair its stored value with a label the dashboard shows. Pass a message key to
translate it per the viewer's language:

```ts
status: field('select', {
  choices: [
    { value: 'draft', label: 'app.status.draft' },
    { value: 'published', label: 'app.status.published' },
  ],
}),
```

`multiSelect` holds an ordered list of distinct strings, stored as a JSON list. With `choices`
every entry must come from the list; without, any strings are legal - free-form tags. Duplicates
collapse on write, and a create that omits the field stores `[]`:

```ts
fields: {
  channels: field('multiSelect', { choices: ['web', 'email', 'push'] }),
  keywords: field('multiSelect'),
}
```

`min` and `max` on a `multiSelect` bound the entry count. In queries, the `includes` operators
probe the list, so `where: { channels: { includes: 'web' } }` finds records carrying an entry.

## Date and time fields

Three types cover moments and calendar values, each stored in the form that matches what it is:

- `date` is a calendar day, stored as `YYYY-MM-DD` text. A day is not an instant, so no timezone
  is involved and no conversion can shift it.
- `time` is a time of day, stored as `HH:MM:SS` text. `HH:MM` input is accepted and stored with
  `:00` seconds.
- `dateTime` is an instant, stored as epoch milliseconds - the same representation `_updatedAt`
  uses. The dashboard renders it in the viewer's own
  [time zone setting](../dashboard/account.md), unless the field pins one.

```ts
fields: {
  publishedOn: field('date'),
  opensAt: field('time', { min: '08:00', max: '18:00' }),
  expiresAt: field('dateTime', { nullable: true }),
}
```

All three take `min` and `max` bounds in their own value form; `dateTime` also accepts ISO 8601
strings there. Because `date` and `time` store fixed-width ISO text, comparisons and sorting work
in calendar and clock order without any parsing.

`dateTime` takes two display options on top. `relativeTime: true` shows the instant as elapsed
time, like "2 hours ago", with the exact date on hover - the way the `Updated` column already
reads. `timezone` pins an IANA zone for the field's cells and calendar, for an instant that belongs
to one place whoever is looking:

```ts
fields: {
  lastSeenAt: field('dateTime', { relativeTime: true }),
  departsAt: field('dateTime', { timezone: 'Asia/Tokyo' }),
}
```

## Write-only and locked fields

Three options control who may see or change a field. Every field kind takes them - columns,
relations, composites, and blocks alike.

`readable: false` makes a field write-only. No read returns it: it is gone from every record a
query or the [collections API](../api/collections.md) hands back, including the record a create or
update returns. Over HTTP, naming it in a filter, select, or sort is indistinguishable from naming
a field that does not exist - a client cannot even learn it is there. Trusted server code reads it
by asking explicitly:

```ts
fields: {
  password: field('password', { readable: false }),
}
```

```ts
const user = await query('Users').select('UUID', 'password').where('email', email).findFirst();
```

That explicit `select` is the one way back in. The framework's own `Users.password` works exactly
like this.

`writable: false` is the mirror: the field drops from the create and update inputs, so its stored
value comes from its `default`. Use it for values the app computes, never the caller.

`immutable: true` locks a field after create. Creates accept it; updates do not. It is a
top-level option: an update rewrites composite items and block instances whole, so a nested value
cannot lock.

`writable` and `immutable` act through the generated input types on the server and through request
validation on the HTTP wire - a locked field in a write body rejects exactly as an unknown one.

## Relations

A relation points at another collection instead of storing a value.

### One reference

`record` holds a reference to one row of another collection:

```ts
fields: {
  author: field('record', { collection: 'Users' }),
}
```

The column stores the target's `UUID`, and it is always nullable - the target can be deleted out
from under it. `onDelete` decides what happens then: `setNull` (the default) clears the reference,
`cascade` deletes the referencing row too, `restrict` blocks the delete while the reference exists.

```ts
author: field('record', { collection: 'Users', onDelete: 'cascade' }),
```

The column is indexed by default. `unique: true` upgrades that index to a one-to-one constraint -
at most one row may reference each target.

### Many references

`records` holds an ordered list of references, stored in a junction table:

```ts
fields: {
  tags: field('records', { collection: 'Tags' }),
}
```

Here `onDelete` is `cascade` or `restrict` and defaults to `cascade`, which removes the link when
its target is deleted - the referencing row stays. `min` and `max` bound how many links a written
list may hold.

### Both sides of a relation

A `records` field owns its junction. The other collection can expose the same relation from its
side with `inverse`, naming the owning field. Both sides then share one junction table, each
keeping its own order:

```ts
// collections/Posts.ts
fields: {
  tags: field('records', { collection: 'Tags' }),
}

// collections/Tags.ts
fields: {
  posts: field('records', { collection: 'Posts', inverse: 'tags' }),
}
```

Reading `posts` on a tag walks the same links `tags` on a post does, backwards. The inverse side
carries no `onDelete` of its own - it follows the owner.

## Composite fields

A composite field stores a nested shape in its own table, not a reference to another collection.

`object` holds one nested group per row, or none:

```ts
fields: {
  seo: field('object', {
    fields: {
      title: field('text'),
      description: field('text', { nullable: true }),
    },
  }),
}
```

`repeater` holds an ordered list of such groups - zero, one, or many:

```ts
fields: {
  sections: field('repeater', {
    fields: {
      heading: field('text'),
      body: field('text'),
    },
  }),
}
```

The subfields are ordinary `field(...)` instances, so a composite may nest further composites and
relations to any depth. Every item carries its own `UUID`, stable across writes, so a read always
tells you which item is which.

Inside a repeater, a `unique` subfield spans every item of every record at once.
`uniquePerParent: true` scopes it to each record's own list, so a value may repeat across records.

A repeater takes `min` and `max` to bound how many items a written list may hold.

## Blocks

Where a repeater repeats one shape, a `blocks` field holds an ordered list of mixed, reusable
shapes, each defined once under `blocks/`. See [blocks](./blocks.md).

## Translations

Any top-level field takes `translatable: true` to hold one value per locale - a scalar per locale,
or a whole item list per locale for composites and `records`. The one exception is an inverse
`records` field: it follows the owning side's junction. A translatable collection also reads
`_translations`, the locales each record holds, beside `UUID` and `_updatedAt`. See
[translations](./translations.md) for the locale set, reading, and writing per locale.

## Dashboard appearance

Every field takes three presentation options, shown wherever the dashboard renders it. `label`
replaces the sentence-cased field name, `description` renders beneath it, and `placeholder` hints
an empty input. Each accepts a plain string or a message key that translates per the viewer's
language:

```ts
fields: {
  slug: field('text', {
    label: 'app.slug.label',
    description: 'Lowercase words joined by hyphens.',
    placeholder: 'my-first-post',
  }),
}
```

A description renders as markdown: bold, code, links, and pipe tables. A long one can start
collapsed behind a "Show description" toggle - pass an object with `text` instead of a string.
`showLabel` and `hideLabel` replace the toggle's labels, and `expanded: true` opens it from the
start:

```ts
fields: {
  cron: field('text', {
    description: {
      text: 'Five fields, space-separated.\n\n|Field|Range|\n|-|-|\n|minute|0-59|\n|hour|0-23|',
    },
  }),
}
```

Two field types take a display variant on top. A `boolean` edits as a checkbox unless you pass
`display: 'switch'`, and a `text` field with `multiline: true` edits as a text area from the
start. Neither changes what is stored:

```ts
fields: {
  published: field('boolean', { display: 'switch' }),
  body: field('text', { multiline: true }),
}
```

The optional collection-level `dashboard` key groups how the dashboard presents the collection
itself. It holds three keys: `icon`, `recordLabel`, and `table`.

`icon` names the [Tabler icon](https://tabler.io/icons) the sidebar menu shows. The name completes
in your editor, and an unknown one fails at boot. Omitted, the menu row renders no icon.

`recordLabel` names the field - or fields - whose values title a record wherever the dashboard
shows one: relation cells, record pickers, the activity feed. A list joins its parts with single
spaces, skipping empty values, so `['firstName', 'lastName']` renders as `Ada Lovelace`, and a
picker search matches each of its first ten words against every part. Each part must be a readable
plain text field.

For anything beyond spaces, write a template: `'{lastName}, {firstName}'` renders as
`Lovelace, Ada`, keeping the literal text between its fields. A literal only renders between
filled fields, so an empty `firstName` gives `Lovelace`, not `Lovelace,`. Search and sorting keep
working: the template's fields are the label fields.
Omitted, the first readable text field titles the record. A record with no label text shows `#`
plus the first eight characters of its `UUID`.

`table` sets the list view's defaults. Its `columns` lists the columns to show, in order, one entry
per field. An entry is a field name, optionally followed by its widths as `name|width|minWidth`,
each a plain CSS length or percentage like `320px` or `50%`. `UUID`, `_updatedAt`, and on a
translatable collection `_translations` are valid names beside your declared readable fields.
Omitted, the list view shows the first four readable fields with `_updatedAt` closing the set; a
translatable collection shows three, then `_translations`.

```ts
export default defineCollection({
  dashboard: {
    icon: 'note',
    recordLabel: 'title',
    table: { columns: ['title | 320px', 'views', '_updatedAt'] },
  },
  fields: {
    title: field('text'),
    views: field('integer'),
  },
});
```

A viewer can rearrange the columns in the dashboard; their choice rides in the URL and overrides
the declared defaults until they restore them.
