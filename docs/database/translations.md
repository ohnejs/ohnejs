# Translations

A translatable field holds one value per locale. You mark the field, configure the locales your
content uses, and scope a query with `.locale()` to pick the locale you [read](./reading.md) or
[write](./writing.md).

```ts
fields: {
  title: field('text', { translatable: true }),
  slug: field('text'),
}
```

```ts
const german = await query('Posts').locale('de').findMany();
```

Content locales are independent from the UI languages your [message catalogs](../i18n/messages.md)
translate. Your app can render its interface in English while serving German records, or the other
way around.

## Marking fields

Any top-level collection field takes `translatable: true`:

```ts
fields: {
  title: field('text', { translatable: true }),
  summary: field('text', { translatable: true, nullable: true }),
  hero: field('record', { collection: 'Images', translatable: true }),
  tags: field('records', { collection: 'Tags', translatable: true }),
  sections: field('repeater', {
    translatable: true,
    fields: {
      heading: field('text'),
      body: field('text'),
    },
  }),
}
```

- A scalar or a [`record`](./field-types.md#record) reference keeps one value per locale.
- A composite, a [`records`](./field-types.md#records), or a [blocks](./blocks.md) field keeps one
  item list per locale. The German query reads and writes the German sections, and the English ones
  stay untouched beside them.
- A composite translates as a whole. Marking one of its subfields is rejected when the collection
  loads, so there is no half-translated repeater item.
- A block's fields are never individually translatable. Mark the blocks field holding them instead.
- An [inverse `records` field](./collections.md#both-sides-of-a-relation) cannot be translatable. It
  follows the owning side's junction.

Changing an existing field to translatable is safe: the next [sync](./sync.md#what-happens-at-boot)
moves its stored values to the default locale, so nothing is lost.

## Configuring locales

The locale set and its default live in `ohne.config.ts`, as
[content locales](../project/config.md#content-locales):

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  collections: {
    locales: ['en', 'de', 'bs'],
    defaultLocale: 'en',
  },
});
```

After codegen, `.locale()` accepts exactly this set, so `.locale('fr')` on the config above is a
compile error.

## Reading

`.locale(code)` scopes the whole chain. Without it, the query reads the default locale, so the two
reads below are the same:

```ts
await query('Posts').findMany();
await query('Posts').locale('en').findMany(); // defaultLocale: 'en'
```

A record can exist without a translation. When the queried locale has none, the record still comes
back:

- Its translatable fields read `null`.
- Its translatable lists read `[]`.
- Its plain fields read as usual.

Nothing falls back to another locale silently. If you want the English title when the German one is
missing, read it and write the fallback yourself:

```ts
post.title ?? fallback.title;
```

Every record of a translatable collection also carries `_translations`: the locales it holds, in
configured order, or `[]` when it holds none. It is read-only, and a `select` can leave it out.

Filter on it to find what is translated, and what is not:

```ts
const untranslated = await query('Posts')
  .where('_translations', (w) => w.not.includes('de'))
  .findMany();
```

- It takes `includes`, `includesAll`, and `includesAny`. You cannot order by it.
- The answer is the same whatever locale the query reads.

To test one field instead, filter at that locale. Any translatable scalar or `record` takes
[`isNull`](./reading.md#null), even a non-nullable one. Translatable lists read `[]`, so use
`empty()`:

```ts
const withoutSummary = await query('Posts')
  .locale('de')
  .where('summary', (w) => w.isNull())
  .findMany();
```

Filters, ordering, and `pluck` on translatable fields act on the queried locale's values.
[`populate`](./reading.md#populating-relations) uses the query's locale for the target too, so a
populated author reads its own translatable fields at the same locale.

A query reads one locale. `.locale()` exists only on collections with a translatable field, and only
once per chain. To fetch every translation of a record, run one query per configured locale.

## Writing

A write goes to the chain's locale, either the one you set or the default:

```ts
await query('Posts').create({ title: 'Hello' }); // stores title under 'en'

await query('Posts')
  .locale('de')
  .where('UUID', post.UUID)
  .update({ title: 'Hallo' }); // stores title under 'de'
```

When a record has no translation at the update's locale, the update creates it:

- Omitted translatable fields take their [defaults](./writing.md#defaults), so a required one
  without a default fails with `required`.
- The returned record's `_translations` lists the locale just written.

An update that touches no translatable field changes nothing about translations: a record without a
translation stays without one.

## Copying a translation

Copying fills a record's translatable values in one locale from another. The dashboard copies
through `POST /collections/posts/[uuid]/translations/copy`, which the
[collections API](../api/collections.md#translations) serves when it exposes the collection's
`update`.

To change what a copy writes, give the collection a `copyTranslation` function. It receives the
`source` record, the default `input`, the `sourceLocale`, and the `targetLocale`, and returns the
input to write:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text', { translatable: true }),
    published: field('boolean', { translatable: true, default: false }),
  },
  copyTranslation: ({ input }) => ({ ...input, published: false }),
});
```

A copied translation now starts unpublished. Whatever the function returns, the copy writes only
translatable fields that are
[writable and not `immutable`](./collections.md#write-only-and-locked-fields), so it never touches a
value shared across locales.

## Deleting translations

A locale-scoped chain has `deleteTranslation` instead of `delete`:

```ts
const { deleted } = await query('Posts')
  .locale('de')
  .where('status', 'archived')
  .deleteTranslation();
```

It removes the matched records' German values and German list items. The records themselves and
every other locale survive. `deleted` counts the records that actually held something in German.
On a [singleton](./collections.md#singletons) it needs no `where`.

[`delete`](./writing.md#deleting-records) stays on the unscoped chain, where its meaning is clear:
it removes whole records, every locale included.

```ts
await query('Posts').where('status', 'spam').delete();
```

## Uniqueness per locale

[`unique`](./collections.md#uniques-and-indexes) on a translatable field applies across every
locale: a value taken in German is taken in English too. When a value only has to be unique within
its own locale, add `uniquePerLocale`:

```ts
fields: {
  slug: field('text', { translatable: true, unique: true, uniquePerLocale: true }),
}
```

Now `hello` can be the English slug of one post and the German slug of another, but never two
German slugs at once.

## Over HTTP

- A [URL query](../api/url-queries.md#locales) carries the locale as a query parameter.
- The [collections API](../api/collections.md) returns `_translations` on every record, limited to
  the locales the operation's [`access` scope](../api/collections.md#the-scope) allows.
- `?where={_translations:{not:{includes:de}}}` filters on it, unless that scope
  [hides locales](../api/collections.md#the-scope).
- `GET /collections/posts/[uuid]/translations` lists the same set for one record.
