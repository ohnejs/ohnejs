# Writing records

`create` inserts one record. It takes the collection's input shape, typed from your schema, and
returns the new record or the reasons it could not be written.

```ts
import { query } from 'ohnejs';

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

On success, `record` is the full record read back after the insert. On failure, `errors` maps each
failing field to a [message](../i18n/messages.md#validation-messages):

- an untranslated key, like `validation.required`,
- a `{ key, params }` object, when the message carries values,
- or the string a custom validator returned.

A nested failure is listed under its path, like `sections[2].title`. To show a key as text,
translate it with [`useT`](../i18n/messages.md#translating-with-uset).

When you would rather handle failures as exceptions, `createOrThrow` returns the record directly
and throws a `ValidationError` whose `errors` carries the same map:

```ts
const post = await query('Posts').createOrThrow({ title: 'Hello' });
```

When you catch it, use `isValidationError`, imported from `ohnejs`, to separate it from any other
failure:

```ts
import { isValidationError, query } from 'ohnejs';

try {
  await query('Posts').createOrThrow({ title: 'Hello' });
} catch (error) {
  if (!isValidationError(error)) throw error;
  error.errors; // { body: 'validation.required' }
}
```

Inside an HTTP handler you rarely catch it yourself:

- A validation error becomes a [`422`](../api/errors.md#write-failures) whose body carries the
  errors, translated into the request's language.
- A [busy database](./engine.md#transactions) becomes a `503` with a `Retry-After`. Outside a
  handler, recognize it with `isBusyError` from `ohnejs` and retry the write.

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

- Relations take `UUID`s, never nested records: `author` is one `UUID`, `tags` a list of them.
- A [`records`](./field-types.md#records), [`repeater`](./field-types.md#repeater), or
  [`blocks`](./field-types.md#blocks) list defaults to `[]`, so you may omit it. Passing `[]` is
  fine too, unless the field sets `allowEmpty: false`, which rejects it with an `emptyValue` error.
  If you omit the field, it still gets the default.
- An [`object`](./field-types.md#object) defaults to no child row, and accepts `null` to say so
  explicitly.
- Unknown keys are rejected, not ignored. A misspelled field fails with an `unknownField` error at
  that key, so it never silently drops its value.

A [`writable: false`](./collections.md#write-only-and-locked-fields) field is not part of either
input, and an `immutable` field is not part of the update input.

## Defaults

If you leave a field out of `create`, it gets its value from the first of these that is available:

1. The field's own `default`.
2. Its [field type's](./custom-field-types.md#defaults) default.
3. `null`, if the field is nullable.

A non-nullable field with no default requires input.

```ts
field('integer', { default: 10 });
```

A default may be a value or a callback. A `records`, `object`, `repeater`, or `blocks` default must
be a callback, because an object or array literal would be one mutable value shared by every created
record. A [`record`](./field-types.md#record) default is a plain `UUID`, so it stays a value.

A default runs through the field's [sanitizers and validators](#sanitizers-and-validators) like any
value. A literal default they reject fails at boot, so `default: ''` on a
[`text`](./field-types.md#text) field needs `allowEmpty: true`. A callback default they reject
fails the create that computes it.

## Sanitizers and validators

A field cleans and checks its value through ordered lists of sanitizers and validators. Sanitizers
change the value and never report an error. Validators return a message when the value is wrong, or
`undefined` when it is fine. A field adds its own to the ones its
[field type](./custom-field-types.md#sanitizers-and-validators) ships:

```ts
field('text', {
  sanitizers: [(value) => value.trim()],
  validators: [(value) => (value.length > 280 ? 'Too long' : undefined)],
});
```

They run in this order, and the first message stops the run for that field:

1. The field type's sanitizers.
2. The field type's validators.
3. The `sanitizers` you pass to `field()`.
4. The `validators` you pass to `field()`.

A returned message always goes under the field's own name. To report a failure inside a composite
value, a validator [writes into `ctx.errors`](./custom-field-types.md#sanitizers-and-validators)
instead.

## Uniqueness and references

A [`unique`](./collections.md#uniques-and-indexes) field is checked before the insert, so a
duplicate fails with a `notUnique` error that names the field, not a raw constraint error. Every
[relation](./collections.md#relations) is checked too: a link to a `UUID` that does not exist fails
with an `invalidReference` error at that field's path.

```ts
const result = await query('Posts').create({ title: 'Hello', author: 'missing' });
result.ok; // false
result.errors.author; // the reference does not exist
```

## Updating records

`update` changes every record a filter matches. `update` and `delete` exist only after a `where`, so
you can never touch every record by accident:

```ts
const result = await query('Posts').where('status', 'draft').update({ status: 'published' });

if (result.ok) {
  result.records; // every matched post, in its new state
} else {
  result.errors; // the same field-to-message map create returns
}
```

`update` returns every matched record, re-read in its final state. `updateOrThrow` returns the array
directly and throws on failure, exactly as `createOrThrow` does.

- An update is partial: fields you omit keep their values, and are never reset to a default or
  cleared.
- A [when-gated field](./conditional-fields.md#on-update) is written only to the records whose
  condition is true.
- It runs the same pipeline `create` does, once for the whole call: validation, sanitizers,
  uniqueness, references. A field error fails the call before anything is written.

## Lists on update

An update replaces a list field with the value you pass. It makes only the changes needed, and does
not delete the whole list and build it again.

A `records` relation takes the new list of `UUID`s. Links you drop are removed, links you add are
appended, and the order follows your list. A link that stays keeps its place on the other side of
the relation, so reordering one side never disturbs the other.

```ts
await query('Posts').where('UUID', id).update({ tags: ['t3', 't1'] });
```

A `repeater` takes the new list of items, each a complete item just as `create` expects:

- Give an item its `UUID` to keep it. That row keeps its identity and is rewritten to the item you
  pass.
- Omit the `UUID` to insert a fresh item.
- Leave an item out to delete it.

Positions follow your order. A kept item is replaced whole: subfields you leave off reset to their
defaults, so always send the complete item.

```ts
await query('Posts').where('UUID', id).update({
  sections: [
    { UUID: 'sec-1', heading: 'Kept, and edited' }, // survives, rewritten
    { heading: 'A brand new section' }, // inserted fresh
  ],
}); // any section you did not list is deleted
```

- A `UUID` that names no item on that record is an error. The update never silently takes an item
  from another record.
- Item `UUID`s tie the update to one record. When the filter matches several, the write fails with a
  `singleRecord` error at the field, so narrow the filter to one record first. A list without
  `UUID`s writes fresh items to every matched record.

A `blocks` field takes envelopes and [replaces its list](./blocks.md#writing) the same way. An
envelope is `{ block: 'Hero', fields: { ... } }`, plus the item's `UUID` on update.

An `object` upserts its single child: pass a value to set it, or `null` to clear it.

```ts
await query('Posts').where('UUID', id).update({ meta: null }); // clears the object
```

## Deleting records

`delete` removes every record a filter matches and reports the count:

```ts
const { deleted } = await query('Posts').where('status', 'spam').delete();
```

A delete cascades: a record's child rows and its relation links are deleted with it. A
[`record` reference](./collections.md#one-reference) from elsewhere follows its own `onDelete` rule:

- `cascade` deletes the referencing row.
- `setNull` clears the link.
- `restrict` blocks the delete while the reference exists. Inside an HTTP handler that becomes a
  [`409`](../api/errors.md#write-failures). Outside one, `isReferenceViolation` from `ohnejs`
  recognizes the error the blocked delete throws.

## Locales

On a collection with [translatable fields](./translations.md), a write goes to the chain's locale.
[Writing translations](./translations.md#writing) covers creating and updating per locale, and a
locale-scoped chain has [`deleteTranslation`](./translations.md#deleting-translations) instead of
`delete`.

## Transactions

Pass an open transaction with `use`, and the write runs inside it instead of opening its own.
[Transactions](./engine.md#transactions) covers opening one:

```ts
await useDatabase().transaction(async (tx) => {
  await query('Posts').use(tx).create({ title: 'Hello' });
});
```
