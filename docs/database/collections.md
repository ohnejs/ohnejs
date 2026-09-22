# Collections and fields

A collection is a table in your database, and each record is a row in it. You declare one as a set
of fields, in one file under `collections/`. Each field becomes a column, a relation, or a nested
table:

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

This page covers the built-in field types, and [field types](./field-types.md) lists every option
each one takes. Every field also takes common options covered elsewhere:

- [`default`](./writing.md#defaults),
  [`sanitizers` and `validators`](./writing.md#sanitizers-and-validators) act when a record is
  written.
- [`when`](./conditional-fields.md) activates a field per record.

When no built-in type fits, [define your own](./custom-field-types.md). To read records back, use
the [query builder](./reading.md).

## Files and names

The file's path names the collection, and [schema sync](./sync.md) creates its table at boot:

- `collections/Posts.ts` becomes `Posts`.
- A subdirectory joins the name: `collections/blog/Posts.ts` becomes `BlogPosts`.
- An `index.ts` takes the name of its directory: `collections/blog/index.ts` becomes `Blog`.
- A file or directory whose name starts with `_` is a helper and is ignored, so shared snippets can
  live beside your collections.

Collection names are converted to PascalCase, and field names are camelCase.

Every collection also gets columns you never declare:

- `UUID` - the text primary key.
- `_updatedAt` - an internal timestamp.

## Column fields

[`text`](./field-types.md#text), [`integer`](./field-types.md#integer),
[`number`](./field-types.md#number), and [`boolean`](./field-types.md#boolean) are the plain column
types. Each stores one value per row.

A field is required unless you pass `nullable: true`, which lets it hold `null`:

```ts
fields: {
  title: field('text'),
  summary: field('text', { nullable: true }),
}
```

- `text` rejects the empty string by default. Pass `allowEmpty: true` to allow it. A value of only
  spaces passes, so add a [trimming sanitizer](./writing.md#sanitizers-and-validators) to reject it.
- `boolean` has no default of its own, so `featured` above must be sent on every create. Pass
  `default: false` to make it optional.
- `integer` holds whole numbers within JavaScript's safe range.
- `number` holds finite decimals, exactly like a JavaScript number. `NaN` and the infinities are
  rejected.

For money, use `integer` minor units (cents), not `number`. A double cannot represent a tenth
exactly, so float arithmetic builds up small errors that money must not have.

`text`, `integer`, and `number` take `min` and `max`. On `integer` and `number` they limit the
value, and on `text` they limit the length in characters. The length is counted like
`String#length`, so an emoji counts as 2:

```ts
fields: {
  title: field('text', { min: 3, max: 120 }),
  rating: field('integer', { min: 1, max: 5 }),
}
```

## Uniques and indexes

Field options cover the single-column cases:

```ts
fields: {
  email: field('text', { unique: true }),
  author: field('text', { index: true }),
}
```

A unique index also works for plain lookups, so if you set both `unique` and `index`, only the
unique index is created.

Constraints over several columns live on the collection, one entry per constraint:

```ts
export default defineCollection({
  fields: {
    email: field('text'),
    tenant: field('text'),
  },
  compositeIndexes: [{ fields: ['email', 'tenant'], unique: true }],
});
```

`fields` lists your field names in order. With `unique: true` the entry is a unique constraint, and
without it a plain index.

The [destructive guard](./sync.md#the-destructive-guard) refuses a new unique constraint when the
existing values contain duplicates.

## Choice fields

[`select`](./field-types.md#select) holds one value out of a list you declare. The generated record
type narrows to exactly that union, and a write with a value outside the list is rejected:

```ts
fields: {
  status: field('select', { choices: ['draft', 'published', 'archived'] }),
}
```

A choice may pair its stored value with a label the dashboard shows. Pass a
[message key](../i18n/messages.md) to translate it into the viewer's language:

```ts
status: field('select', {
  choices: [
    { value: 'draft', label: 'app.status.draft' },
    { value: 'published', label: 'app.status.published' },
  ],
}),
```

[`multiSelect`](./field-types.md#multiselect) holds an ordered list of distinct strings, stored as
a JSON list:

```ts
fields: {
  channels: field('multiSelect', { choices: ['web', 'email', 'push'] }),
  keywords: field('multiSelect'),
}
```

- With `choices`, every entry must come from the list. Without it, any strings are allowed, like
  free-form tags.
- Duplicates are removed on write.
- A create that omits the field stores `[]`.
- `min` and `max` limit the number of entries.

In queries, the [`includes` operators](./reading.md#filtering) check the list, so
`.where('channels', (w) => w.includes('web'))` finds records that have that entry.

## Date and time fields

The date and time types store each value in the form that matches what it is:

- [`date`](./field-types.md#date) is a calendar day, stored as `YYYY-MM-DD` text. A day is not an
  instant, so no timezone is involved and no conversion can shift it.
- [`time`](./field-types.md#time) is a time of day, stored as `HH:MM:SS` text. `HH:MM` input is
  accepted and stored with `:00` seconds.
- [`dateTime`](./field-types.md#datetime) is an instant, stored as epoch milliseconds, like
  `_updatedAt`. The dashboard renders it in the viewer's own
  [time zone setting](../dashboard/account.md#the-settings), unless the field sets a fixed zone.

```ts
fields: {
  publishedOn: field('date'),
  opensAt: field('time', { min: '08:00', max: '18:00' }),
  expiresAt: field('dateTime', { nullable: true }),
}
```

Each takes `min` and `max` in its own value form, and `dateTime` also accepts ISO 8601 strings
there. A `dateTime` write is stricter: it takes epoch milliseconds only, so pass
`date.getTime()`, not a `Date` or an ISO string. `date` and `time` store fixed-width text, so they
compare and sort in calendar and clock order.

`dateTime` also takes display options:

- `relativeTime: true` shows the instant as elapsed time, like "2 hours ago", with the exact date
  on hover.
- `timezone` sets a fixed IANA zone for the field's cells and calendar. Use it for an instant that
  belongs to one place, no matter who is looking.

```ts
fields: {
  lastSeenAt: field('dateTime', { relativeTime: true }),
  departsAt: field('dateTime', { timezone: 'Asia/Tokyo' }),
}
```

## Write-only and locked fields

`readable`, `writable`, and `immutable` control who may see or change a field. Every field kind
takes them - columns, relations, composites, and blocks alike.

- `readable: false` makes a field write-only. No read returns it, including the record a create or
  update returns.
- `writable: false` drops the field from the create and update inputs, so its value comes from its
  `default`. Use it for values that the app computes and the caller never sets.
- `immutable: true` locks a field after create: creates accept it, and updates do not. It is allowed
  only on top-level fields, because an update rewrites composite items and block instances
  completely.

Server code reads a write-only field by selecting it explicitly. That is the only way to read it,
and it is how the framework's own `Users.password` works. Without the flag, every read would return
the password hash, including over the collections API:

```ts
fields: {
  password: field('password', { readable: false }),
}
```

```ts
const user = await query('Users').select('UUID', 'password').where('email', email).findFirst();
```

In server code, the generated input types enforce `writable` and `immutable`. Over HTTP, through the
[collections API](../api/collections.md) or a [URL query](../api/url-queries.md):

- A write-only field in a filter, select, or sort is treated like a field that does not exist, so
  a client cannot learn it is there.
- A `writable: false` or locked field in a write body is rejected like an unknown one.

## Relations

A relation points at another collection instead of storing a value.

### One reference

[`record`](./field-types.md#record) holds a reference to one row of another collection:

```ts
fields: {
  author: field('record', { collection: 'Users' }),
}
```

The column stores the target's `UUID`. It is always nullable, because the target can be deleted
while the reference still points to it. No option makes it required, not even a validator, because
`null` skips validators. `onDelete` decides what happens on that delete:

- `setNull` (the default) clears the reference.
- `cascade` deletes the referencing row too. Inside a repeater, that row is the item, not the record
  that owns it.
- `restrict` blocks the delete while the reference exists.

```ts
author: field('record', { collection: 'Users', onDelete: 'cascade' }),
```

The column is indexed by default. `unique: true` upgrades that index to a one-to-one constraint:
at most one row may reference each target.

### Many references

[`records`](./field-types.md#records) holds an ordered list of references, stored in a junction
table:

```ts
fields: {
  tags: field('records', { collection: 'Tags' }),
}
```

- `onDelete` is `cascade` (the default) or `restrict`. `cascade` removes the link when its target
  is deleted, and the referencing row stays.
- `min` and `max` limit how many links a written list may hold.
- `allowEmpty: false` rejects a written `[]`.
- A list that names the same `UUID` twice fails with a `notUnique` error. It is not deduplicated
  like a `multiSelect`.

### Both sides of a relation

A `records` field owns its junction. The other collection can expose the same relation from its
side with `inverse`, naming the owning field. Both sides then share one junction table, each
keeping its own order:

```ts
// collections/Posts.ts
fields: {
  tags: field('records', { collection: 'Tags' }),
}
```

```ts
// collections/Tags.ts
fields: {
  posts: field('records', { collection: 'Posts', inverse: 'tags' }),
}
```

Reading `posts` on a tag uses the same links as `tags` on a post, in the opposite direction. The
inverse side has no `onDelete` of its own. It follows the owner.

To read related records, [populate](./reading.md#populating-relations) them.

## Composite fields

A composite field stores a nested shape in its own table, not a reference to another collection.

[`object`](./field-types.md#object) holds one nested group per row, or none:

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

[`repeater`](./field-types.md#repeater) holds an ordered list of such groups - zero, one, or many:

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
relations to any depth. Every item has its own `UUID`, which stays the same across writes. This is
how an [update keeps an item](./writing.md#lists-on-update).

- `min` and `max` limit how many items a written repeater list may hold, and `allowEmpty: false`
  rejects a written `[]`.
- A `unique` subfield is unique across every item of every record. `uniquePerParent: true` limits it
  to each record's own list, so a value may repeat across records.
- `layout` arranges the subfields in the editor, in the same
  [grammar](../dashboard/field-layouts.md) a collection uses.

## Blocks

A repeater repeats one shape. A [`blocks`](./field-types.md#blocks) field holds an ordered list of
mixed, reusable shapes, each defined once under `blocks/`. [Blocks](./blocks.md) covers defining,
reading, and writing them.

## Translations

Any top-level collection field takes [`translatable: true`](./translations.md#marking-fields) to
hold one value per locale.
[Translations](./translations.md) covers which fields can be translated, the locale set, and
reading and writing per locale.

## Singletons

A singleton is a collection that holds exactly one record, like site settings. Mark it with
`singleton: true`:

```ts
// collections/Settings.ts
export default defineCollection({
  singleton: true,
  api: { read: 'public', update: true },
  fields: {
    siteName: field('text', { translatable: true, default: 'My site' }),
    contactEmail: field('text', { nullable: true }),
    links: field('repeater', { fields: { url: field('text') } }),
  },
});
```

[Schema sync](./sync.md#what-happens-at-boot) creates the record from the field defaults, so it
always exists. You never create or delete it yourself:

- Every field must work without input. Give it `nullable: true` or a `default`, unless it is a
  relation, a composite, or a blocks field - those start empty on their own.
- [`api`](../api/collections.md#exposure) may open `read` and `update` only.
- A top-level [`record`](#one-reference) field cannot use `onDelete: 'cascade'`, since deleting its
  target would delete the record. The same goes for an upload's
  [`image` or `file`](../uploads/fields.md#options) field.

Reading and writing need no filter:

```ts
const settings = await query('Settings').findFirst();

await query('Settings').update({ contactEmail: 'hello@example.com' });
```

- An unfiltered `findFirst` returns the record, never `undefined`.
- [`update`](./writing.md#updating-records) and
  [`deleteTranslation`](./translations.md#deleting-translations) work without a `where`. `create`
  and `delete` do not exist.

In the dashboard, the collection's menu row opens the record's editor instead of a list.

## Dashboard appearance

Every field takes presentation options, shown wherever the dashboard renders it. Each accepts a
plain string or a [message key](../i18n/messages.md) that is translated into the viewer's language:

- `label` replaces the sentence-cased field name.
- `description` renders below it, as markdown: bold, code, links, and pipe tables.
- `placeholder` shows a hint in an empty input, on fields that have one.

```ts
fields: {
  slug: field('text', {
    label: 'app.slug.label',
    description: 'Lowercase words joined by hyphens.',
    placeholder: 'my-first-post',
  }),
}
```

A long description can start collapsed behind a "Show description" toggle. Pass an object with
`text` instead of a string. `showLabel` and `hideLabel` replace the toggle's labels, and
`expanded: true` opens it from the start.

```ts
fields: {
  slug: field('text', {
    description: {
      text: 'app.slug.help',
      showLabel: 'Show examples',
      hideLabel: 'Hide examples',
    },
  }),
}
```

Two options change only the editor, never what is stored:

- A `boolean` is edited as a checkbox, as a switch with `display: 'switch'`, or as two buttons with
  `display: 'buttons'`, labeled by `trueLabel` and `falseLabel`.
- A `text` field with `multiline: true` is edited as a text area.

## The collection in the dashboard

The collection-level `dashboard` key sets how the dashboard presents the collection itself:

```ts
export default defineCollection({
  dashboard: {
    icon: 'note',
    recordLabel: 'title',
    table: { columns: ['title | 320px', 'views', '_updatedAt'] },
    layout: [{ row: ['title', 'views | 8rem'] }],
  },
  fields: {
    title: field('text'),
    views: field('integer'),
  },
});
```

- `icon` - the [Tabler icon](https://tabler.io/icons) the sidebar menu shows. Your editor
  autocompletes the name, and an unknown one fails at boot. If you omit it, the menu row shows no
  icon.
- `recordLabel` - the field that gives a record its title, as [record labels](#record-labels)
  describes.
- `table` - the list view's [default columns](#table-columns).
- `layout` - how the record editor [arranges the fields](../dashboard/field-layouts.md).

### Record labels

`recordLabel` names the field whose value is a record's title wherever the dashboard shows one:
relation cells, record pickers, and the activity feed. Each field it names must be a readable plain
text field.

- A list joins its fields with single spaces, skipping empty values: `['firstName', 'lastName']`
  renders as `Anduin Wrynn`.
- A template keeps literal text between its fields: `'{lastName}, {firstName}'` renders as
  `Wrynn, Anduin`. A literal renders only between filled fields, so an empty `firstName` gives
  `Wrynn`, not `Wrynn,`.

Search and sorting use the label's fields. A picker search matches each of its first ten words
against every field.

If you omit the option, the first readable text field gives the record its title. A record with no
label text shows `#` plus the last eight characters of its `UUID`.

### Table columns

`table.columns` lists the list view's columns in order, one entry per field. An entry may add its
widths as `name|width|minWidth`, each a CSS length or percentage like `320px` or `50%`.

- Your readable fields are valid names, plus `UUID`, `_updatedAt`, and on a translatable collection
  `_translations`.
- If you omit it, the list view shows the first four readable fields, with `_updatedAt` as the last
  column. A translatable collection shows three, then `_translations`.

A viewer can rearrange the columns in the dashboard. Their choice is stored in the URL and overrides
the declared defaults until they restore them.
