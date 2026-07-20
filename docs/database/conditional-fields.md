# Conditional fields

A `when` makes a field active only when a condition holds. An inactive field is left out of the
write: its input is dropped, and on create it falls back to its default. Reach for it when a field
only makes sense in some states of a record - a discount that applies during a sale, a reason
required only when something is rejected.

```ts
discount: field('integer', { nullable: true, when: { kind: 'sale' } }),
```

This `discount` is active only when the record's `kind` is `sale`. Write it on any other kind and
the value is ignored.

## Active and inactive

On create, an active field behaves normally - your input is validated and stored. An inactive field
drops whatever you passed and takes its default instead. A value cannot sneak into a field its
condition turned off.

```ts
await query('Products').create({ kind: 'sale', discount: 20 }); // discount: 20
await query('Products').create({ kind: 'gift', discount: 20 }); // discount: its default, not 20
```

An inactive create still needs a value to store, so a gated field must have a fallback: make it
**nullable or give it a default**. A list field - a `records`, `repeater`, or `blocks` - needs
neither, since its inactive value is the empty list. This is checked when your collections load,
so a gate that could strand a field fails fast.

## Paths

A condition reads other fields by name. A bare name is a sibling in the same scope:

```ts
field('text', { nullable: true, when: { status: 'approved' } });
```

Inside a composite - an `object` or `repeater` item - the same bare name reads a sibling subfield.
To reach past the item, anchor the path: a leading `/` starts at the record root, and each `../`
climbs one level.

```ts
// a repeater subfield, active only when the record's top-level `kind` is `promo`
field('text', { nullable: true, when: { '../kind': 'promo' } });
```

A dot descends into a composite (`address.city`). A relation cannot be walked - a `record` or
`records` is a `UUID` at write time - so test one with bare existence:

```ts
field('text', { nullable: true, when: { author: { has: true } } });
```

A [blocks](./blocks.md) field cannot be walked either - its list mixes shapes - so it too takes
only the bare `has: true`. A composite can be walked: a `has` on an `object` or `repeater` may
nest a condition, which reads the item's own subfields.

The condition uses the same object form as a `where` in
[querying over HTTP](../api/url-queries.md#filtering): a bare `field: value` matches on equality,
a `{ op: value }` object is a comparison, sibling keys combine with AND, and `and`, `or`, and
`not` group them.

```ts
field('integer', {
  nullable: true,
  when: { published: true, views: { atLeast: 100 } },
});
```

Every operator and path is checked against your schema when the collection loads, so a typo or an
operator a field cannot support is caught before anything runs.

## On update

An update decides activation per matched record. A gated field is written only to the records whose
condition holds; the rest keep their current value, untouched.

```ts
// across a season's products, only the ones on sale get the new discount
await query('Products').where('season', 'winter').update({ discount: 30 });
```

Activation reads your input laid over each record's current row, so changing the gate field in the
same call takes effect. Setting `kind` to `sale` while writing `discount` activates the discount for
that record.

A record where every field you passed is inactive is left completely untouched - no write, and its
`_updatedAt` is not bumped.

When you want every matched record written, do not lean on the gate - narrow the filter to the gate
condition instead. The intent is clearer, and every matched row is one you meant to change.

```ts
await query('Products').where('kind', 'sale').update({ discount: 30 });
```

## Gating on a gated field

On create, every gate reads the same view of the write: your input, coerced, with defaults filled
in for what you left out. No gate sees another gate's outcome. So a gate that reads a sibling which
is itself gated can skew: the sibling's input activates your field, then the sibling's own
condition drops that input and stores the default.

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

`kind` is `gift`, so `discount` is inactive and stores `null`. But `banner`'s gate read the input,
where `discount` was `20` - so `banner` activated and stored. The record now holds a `banner` its
own condition does not justify, and an update, gating against the stored row, will treat `banner`
as inactive.

Keep a chain straight: gate on fields that are not themselves gated, or repeat the upstream
condition in the downstream `when` - here `when: { kind: 'sale', discount: { atLeast: 10 } }` - so
both gates turn off together.

## Inside a composite

A `when` on a subfield of an `object` or `repeater` works the same way, and it can read past the
item: a `../` climbs to the enclosing record, so a subfield can depend on a top-level field.

```ts
field('repeater', {
  fields: {
    heading: field('text'),
    badge: field('text', { nullable: true, when: { '../kind': 'promo' } }),
  },
});
```

On create it gates like any field. On update it gates per matched record too: `../kind` reads that
record's stored `kind`, so you need not re-provide it.

One difference from a top-level field: an update rewrites a whole item, so an inactive subfield
resets to its default - exactly like a subfield you left out of the item. It is not kept.

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

A [block's](./blocks.md) own fields take `when` too, with one restriction: the paths stay inside
the block. `/` and `../` are rejected - a block can sit in any collection, so it cannot anchor
into a host it does not know.
