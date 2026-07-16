# Collections and fields

A collection is a set of fields, declared in one file under `collections/`. Each field becomes a
column, a relation, or a nested table. This guide covers the field types; see
[schema sync](./sync.md) for how a collection file becomes a table, and
[reading records](./queries.md) for querying them.

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

`text`, `integer`, and `boolean` are the column types. Each stores one value per row.

A field is required unless you pass `nullable: true`, which lets the column hold `null`:

```ts
fields: {
  title: field('text'),
  summary: field('text', { nullable: true }),
}
```

`unique` and `index` cover single-column constraints; multi-column ones live on the collection.
Both are in [schema sync](./sync.md).

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

## Blocks

Where a repeater repeats one shape, a `blocks` field holds an ordered list of mixed, reusable
shapes, each defined once under `blocks/`. See [blocks](./blocks.md).

## Translations

Any top-level field takes `translatable: true` to hold one value per locale - a scalar per locale,
or a whole item list per locale for composites and `records`. See [translations](./translations.md)
for the locale set, reading, and writing per locale.
