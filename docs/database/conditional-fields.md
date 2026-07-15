# Conditional fields

A `when` makes a field active only when a condition holds. An inactive field is left out of the
write: its input is dropped, and it falls back to its default. Reach for it when a field only makes
sense in some states of a record - a discount that applies during a sale, a reason required only
when something is rejected.

```ts
field('integer', { nullable: true, when: { kind: 'sale' } });
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

Because an inactive field always falls back to a default, a `when`-gated field must be **nullable or
carry a default**. Otherwise an inactive create would have no value to store. This is checked when
your collections load, so a gate that could strand a field fails fast.

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

The condition uses the same object form as a [query `where`](./queries.md): sibling keys combine
with AND, and `and`, `or`, and `not` group them. Every operator and path is checked against your
schema when the collection loads, so a typo or an operator a field cannot support is caught before
anything runs.

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
// the record's kind is 'draft'; note is gated on '../kind' == 'published'
await query('Posts').where('UUID', id).update({
  revisions: [{ UUID: r, note: 'hi' }], // label left out, note provided
});
// -> revision: { note: null, label: null }
//    note is inactive, label is omitted - both reset to their default
```
