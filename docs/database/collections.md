# Collections and fields

A collection is a set of fields, declared in one file under `collections/`. Each field becomes a
column, a relation, or a nested table. This guide covers the field types; see
[schema sync](./sync.md) for how a collection file becomes a table, and
[reading records](./queries.md) for querying them. Every field also takes per-value options:
`default`, `sanitizers`, and `validators` act at write time, covered in
[writing records](./writing.md); `when` activates a field per record, covered in
[conditional fields](./conditional-fields.md).

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohne';

export default defineCollection({
  fields: {
    title: field('text'),
    views: field('integer'),
    featured: field('boolean'),
  },
});
```

## Column fields

`text`, `integer`, `number`, and `boolean` are the column types. Each stores one value per row.

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

`unique` and `index` cover single-column constraints; multi-column ones live on the collection.
Both are in [schema sync](./sync.md).

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
its target is deleted - the referencing row stays.

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

## Blocks

Where a repeater repeats one shape, a `blocks` field holds an ordered list of mixed, reusable
shapes, each defined once under `blocks/`. See [blocks](./blocks.md).

## Translations

Any top-level field takes `translatable: true` to hold one value per locale - a scalar per locale,
or a whole item list per locale for composites and `records`. The one exception is an inverse
`records` field: it follows the owning side's junction. See [translations](./translations.md)
for the locale set, reading, and writing per locale.
