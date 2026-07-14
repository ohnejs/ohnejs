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
  result.errors; // { [field: string]: string }
}
```

On success, `record` is the full record read back after the insert: your fields, the generated
`UUID`, and the `_updatedAt` timestamp. On failure, `errors` maps each failing field to a
ready-to-show message. A nested failure is keyed by its path: `sections[2].title`, `author`.

When you would rather handle failures as exceptions, `createOrThrow` returns the record directly
and throws a `validationError` carrying the same map:

```ts
const post = await query('Posts').createOrThrow({ title: 'Hello' });
```

Inside an HTTP handler you rarely catch it yourself: a thrown `validationError` becomes a `422`
whose body carries the errors, and a busy database becomes a `503` with a `Retry-After`.

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
`records` or `repeater` list defaults to `[]`, so you may omit it. An `object` defaults to no
child row, and accepts `null` to say so explicitly.

Unknown keys are rejected, not ignored. A typo in a field name fails the write with an
`unknownField` error at that key, so a misspelled field never silently drops its value.

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

A default may be a value or a callback. A relation or composite default must be a callback, since a
shared object or array literal would be shared mutable state across every created record.

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
validators - and the first message stops the field. A validator that returns a message keyed by a
subfield path reports a failure deep inside a composite.

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

## Transactions

Pass an open transaction with `use` to run the write inside it, rather than opening its own:

```ts
await query('Posts').use(tx).create({ title: 'Hello' });
```

Writes on one connection serialize, so two concurrent creates never collide mid-transaction; each
runs to completion in turn.
