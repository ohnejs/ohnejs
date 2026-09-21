# Conditional fields

A `when` makes a field active only when a condition is true. An inactive field is left out of the
write: its input is dropped, and on create it falls back to its default. Use it when a field only
makes sense in some states of a record: a discount that applies during a sale, or a reason required
only when something is rejected.

```ts
discount: field('integer', { nullable: true, when: { kind: 'sale' } }),
```

This `discount` is active only when the record's `kind` is `sale`. If you write it on any other
kind, the value is ignored.

## Active and inactive

On create, an active field behaves normally: your input is
[validated](./writing.md#sanitizers-and-validators) and stored. An inactive field drops whatever you
passed and takes its [default](./writing.md#defaults) instead, so a value cannot be stored in a
field that its condition turned off.

```ts
await query('Products').create({ kind: 'sale', discount: 20 }); // discount: 20
await query('Products').create({ kind: 'gift', discount: 20 }); // discount: its default, not 20
```

Give a gated field (a field with a `when`) a fallback: make it **nullable or give it a default**.
List fields ([`records`](./field-types.md#records), [`repeater`](./field-types.md#repeater),
[`blocks`](./field-types.md#blocks)) fall back to `[]` and need neither. A collection with a gated
field that has no fallback fails to load.

## Conditions

A condition uses the same object form as a `where` in
[querying over HTTP](../api/url-queries.md#filtering):

- A bare `field: value` matches when the field equals the value.
- A `{ op: value }` object is a comparison.
- Sibling keys combine with AND.
- `and`, `or`, and `not` group them.

```ts
field('integer', {
  nullable: true,
  when: { published: true, views: { atLeast: 100 } },
});
```

Every operator and path is checked against your schema when the collection loads, so a typo, or an
operator that a field cannot support, is caught before anything runs.

## Paths

A condition reads other fields by name. A bare name is a sibling in the same scope. At the top
level, that is another top-level field. Inside an [`object`](./field-types.md#object) or
`repeater` item, it is another subfield of that item.

- A leading `/` starts at the record root.
- Each `../` goes up one level, so a subfield can read a top-level field.
- A dot goes down into an `object`: `address.city`.
- A condition cannot look inside a relation or a [blocks](./blocks.md) field, so test it with
  `{ has: true }`.
- A `has` on an `object` or `repeater` may nest a condition on the item's own subfields.

```ts
// a repeater subfield, active only when the record's top-level `kind` is `promo`
field('text', { nullable: true, when: { '../kind': 'promo' } });

// active only when a relation is set
field('text', { nullable: true, when: { author: { has: true } } });
```

## On update

An update decides for each matched record whether the field is active. A gated field is written only
to the records where its condition is true, and the rest keep their current value:

```ts
// across a season's products, only the ones on sale get the new discount
await query('Products').where('season', 'winter').update({ discount: 30 });
```

- The condition reads each record's current row, with the values you passed replacing the stored
  ones. Setting `kind` to `sale` while writing `discount` activates the discount for that record.
- A record where every field you passed is inactive is not written at all, and its `_updatedAt` does
  not change.

To write every matched record, filter by the gate condition instead of relying on the gate. The
intent is clearer, and every matched row is one you meant to change:

```ts
await query('Products').where('kind', 'sale').update({ discount: 30 });
```

## Gating on a gated field

Gate on fields that are not gated themselves. If a `when` does read a gated field, repeat that
field's condition in it. Otherwise a chain can store a value that its own condition does not allow:

```ts
// collections/Products.ts
fields: {
  kind: field('text'),
  discount: field('integer', { nullable: true, when: { kind: 'sale' } }),
  banner: field('text', { nullable: true, when: { discount: { atLeast: 10 } } }),
}
```

```ts
await query('Products').create({ kind: 'gift', discount: 20, banner: 'Save 20%' });
// -> discount: null, banner: 'Save 20%'
```

On create, every gate reads the same view of the write: your input, converted to the field types,
with defaults filled in. No gate sees the result of another gate. `kind` is `gift`, so `discount` is
inactive and stores `null`. But `banner`'s gate read the input, where `discount` was `20`, so
`banner` was stored. A later update checks the gate against the stored row and treats `banner` as
inactive.

Repeating the discount's condition fixes it: `when: { kind: 'sale', discount: { atLeast: 10 } }`
turns both gates off together.

## Inside a composite

A `when` on a subfield of an `object` or `repeater` gates like any field. It reads fields outside
the item with the [paths](#paths) above. On update, `../kind` reads each matched record's stored
`kind`, so you do not need to pass it again.

One difference from a top-level field: an update
[rewrites a whole item](./writing.md#lists-on-update), so an inactive subfield resets to its
default, exactly like a subfield you left out. It is not kept.

```ts
// collections/Posts.ts
fields: {
  kind: field('text'),
  revisions: field('repeater', {
    fields: {
      note: field('text', { nullable: true, when: { '../kind': 'published' } }),
      label: field('text', { nullable: true }),
    },
  }),
}
```

```ts
// the record's kind is 'draft', so note is inactive
await query('Posts').where('UUID', id).update({
  revisions: [{ UUID: r, note: 'hi' }], // label left out, note provided
});
// -> revisions: [{ note: null, label: null }]
//    note is inactive, label is omitted - both reset to their default
```

A [block's](./blocks.md) own fields take `when` too, but their paths stay inside the block. `/` and
`../` are rejected, because a block can sit in any collection and cannot know the fields outside it.
