# Writing records

`create` inserts one record. It takes the collection's input shape, typed from your schema, and
returns the new record or the reasons it could not be written.

```ts
import { query } from 'ohne';

const result = await query('Posts').create({ title: 'Hello', body: '...' });
```

The whole write runs in one transaction: validation, uniqueness, references, the insert, and the
derived rows all commit together, or nothing does.

## The result

`create` never throws for a validation failure. It returns a result you check:

```ts
const result = await query('Posts').create({ title: 'Hello' });

if (result.ok) {
  result.record; // the new post, exactly as a read would return it
} else {
  result.errors; // { body: 'validation.required' }
}
```

On success, `record` is the full record read back after the insert: your fields, the generated
`UUID`, and the `_updatedAt` timestamp. On failure, `errors` maps each failing field to a message:
an untranslated key like `validation.required`, a `{ key, params }` object when the message carries
values, or the string a custom validator returned. A nested failure is keyed by its path:
`sections[2].title`, `author`. Outside a handler, resolve a key to display text yourself with
`useT` - see [messages](../i18n/messages.md).

When you would rather handle failures as exceptions, `createOrThrow` returns the record directly
and throws a `validationError` carrying the same map:

```ts
const post = await query('Posts').createOrThrow({ title: 'Hello' });
```

Inside an HTTP handler you rarely catch it yourself: a thrown `validationError` becomes a `422`
whose body carries the errors, each resolved to display text in the request's language, and a busy
database becomes a `503` with a `Retry-After`.

## Input

The input is typed per collection. A field is optional when it is nullable or has a default, and
required otherwise, so the type tells you what a record needs before you run it.

```ts
await query('Posts').create({
  title: 'Hello', // required: a non-nullable text field with no default
  summary: null, // optional: nullable, so null is a value
  author: 'a1b2...', // a `record` relation, given the target's UUID
  tags: ['t1', 't2'], // a `records` relation, a list of UUIDs
  sections: [{ heading: 'Intro' }], // a `repeater`, a list of item shapes
});
```

Relations take `UUID`s, never nested records: `author` is one `UUID`, `tags` a list of them. A
`records` or `repeater` list defaults to `[]`, so you may omit it. Passing `[]` explicitly is fine
too, unless the field sets `allowEmpty: false`: that rejects the empty list with an `emptyValue`
error, while omission still lands the default. An `object` defaults to no child row, and accepts
`null` to say so explicitly.

Unknown keys are rejected, not ignored. A typo in a field name fails the write with an
`unknownField` error at that key, so a misspelled field never silently drops its value.

A `writable: false` field is absent from both inputs, an `immutable` one from the update input
alone; see [write-only and locked fields](./collections.md#write-only-and-locked-fields).

## Defaults

A field type may ship a default, and an instance may set its own. When create input omits the
field, the instance default wins, then the type's, then `null` for a nullable field. A
non-nullable field with no default requires input.

```ts
// a field type with a default
export default defineField({ columnType: 'integer', defaultValue: 0 });

// an instance overriding it
field('integer', { default: 10 });
```

A default may be a value or a callback. A `records`, `object`, `repeater`, or `blocks` default must
be a callback, since a shared object or array literal would be shared mutable state across every
created record. A `record` default is a plain `UUID`, so it stays a value.

## Sanitizers and validators

A field type cleans and checks its value through two ordered lists. Sanitizers transform the value
and never report; validators return a message when the value is wrong, or `undefined` when it is
fine.

```ts
export default defineField({
  columnType: 'text',
  sanitizers: [(value) => (typeof value === 'string' ? value.trim() : value)],
  validators: [(value) => (value === '' ? 'This value must not be empty' : undefined)],
});
```

An instance adds its own, run after the type's:

```ts
field('text', {
  validators: [(value) => (String(value).length > 280 ? 'Too long' : undefined)],
});
```

The tiers run in order - type sanitizers, type validators, instance sanitizers, instance
validators - and the first message stops the field. A returned message always lands at the field's
own name. To report a failure deep inside a composite value, write into `ctx.errors` keyed by the
subfield path; the pipeline prefixes it under the field:

```ts
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

On a field named `address`, that failure lands at `address.city`.

## Uniqueness and references

A `unique` field is prechecked before the insert, so a duplicate fails with a `notUnique` error
naming the field rather than a raw constraint error. Every relation is checked too: a `record` or
`records` link to a `UUID` that does not exist fails with an `invalidReference` error at that
field's path.

```ts
const result = await query('Posts').create({ title: 'Hello', author: 'missing' });
result.ok; // false
result.errors.author; // the reference does not exist
```

## Updating records

`update` changes every record a filter matches. Narrow the query with `where` first, then pass the
fields to change:

```ts
const result = await query('Posts').where('status', 'draft').update({ status: 'published' });
```

An update is partial. Only the fields you pass change; every other column is left exactly as it was.
A field you omit is never defaulted or cleared. A [when-gated field](./conditional-fields.md) adds
its own rule: create drops inactive input, and an update writes the field only to the records whose
condition holds.

It runs the same pipeline `create` does - validation, sanitizers, uniqueness, references - once for
the whole call. A field error fails the call before anything is written.

`update` returns every matched record, re-read in its final state:

```ts
const result = await query('Posts').where('status', 'draft').update({ status: 'published' });

if (result.ok) {
  result.records; // every matched post, in its new state
} else {
  result.errors; // the same field-to-message map create returns
}
```

`updateOrThrow` returns the array directly and throws a `validationError` on failure, exactly as
`createOrThrow` does.

A `where` is required. `update` and `delete` are offered only once a filter narrows the query, so an
unfiltered write that would touch every record can never happen by accident.

## Lists on update

An update replaces a list field with the value you pass, but by the shortest path, not by tearing
the list down and rebuilding it.

A `records` relation takes the new list of `UUID`s. Links you drop are removed, links you add are
appended, and the order follows your list. A link that stays keeps its place on the other side of
the relation, so reordering one side never disturbs the other.

```ts
await query('Posts').where('UUID', id).update({ tags: ['t3', 't1'] });
```

A `repeater` takes the new list of items, each a complete item just as `create` expects. Give an
item its `UUID` to keep it: that row survives with its identity, rewritten to the item you pass.
Omit the `UUID` to insert a fresh item. An item you leave out is deleted, and the positions renumber
to your order.

A kept item is a rewrite, not a merge. A subfield you leave off does not survive from the stored
item - it takes its default, exactly as it would on create. Sending `{ UUID, heading }` to change
one heading resets every other subfield of that item, so always send the complete item.

```ts
await query('Posts').where('UUID', id).update({
  sections: [
    { UUID: 'sec-1', heading: 'Kept, and edited' }, // survives, rewritten
    { heading: 'A brand new section' }, // inserted fresh
  ],
}); // any section you did not list is deleted
```

A `UUID` that names no item on that record is an error, never a silent adoption from another record.

Item `UUID`s also tie the update to a single record. When the filter matches several, no `UUID` can
say which record's item it means, so the write fails with a `singleRecord` error at the field -
narrow the filter to one record first. A list without `UUID`s carries no such tie: fresh items write
to every matched record.

A `blocks` field takes envelopes - `{ block: 'Hero', fields: { ... } }`, plus the item's `UUID` on
update - and replaces its list the same way. See [blocks](./blocks.md#writing).

An `object` upserts its single child: pass a value to set it, or `null` to clear it.

```ts
await query('Posts').where('UUID', id).update({ meta: null }); // clears the object
```

## Deleting records

`delete` removes every record a filter matches and reports the count:

```ts
const { deleted } = await query('Posts').where('status', 'spam').delete();
```

A delete cascades: a record's child rows and its relation links go with it. A `record` reference
from elsewhere follows its own `onDelete` rule - `cascade` deletes the referencing row, `setNull`
clears the link. A `restrict` reference still pointing at the record blocks the delete, and inside
an HTTP handler becomes a `409`.

Like `update`, `delete` requires a `where`.

## Locales

On a collection with [translatable fields](./translations.md), a write lands on the chain's locale:
`create` stores translatable values there, `update` upserts them, and a locale-scoped chain swaps
`delete` for `deleteTranslation`. The guide covers each.

## Transactions

Pass an open transaction with `use` to run the write inside it, rather than opening its own. Open
one with `useDatabase().transaction`, covered in [the engine guide](./engine.md):

```ts
await useDatabase().transaction(async (tx) => {
  await query('Posts').use(tx).create({ title: 'Hello' });
});
```

Writes on one connection serialize, so two concurrent creates never collide mid-transaction; each
runs to completion in turn.
