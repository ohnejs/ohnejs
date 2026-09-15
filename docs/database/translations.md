# Translations

A translatable field holds one value per locale. You mark the field, configure the locales your
content speaks, and scope a query with `.locale()` - everything else stays the query surface you
already know.

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
translate. A site can render its interface in English while serving German records, or the other
way around.

## Marking fields

Any top-level field takes `translatable: true`:

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

A column-bearing field - a scalar or a `record` reference - keeps one value per locale. A
composite or `records` field keeps one item list per locale: the German query reads and writes the
German sections, the English ones untouched beside them. So does a [blocks](./blocks.md) field:
one block list per locale.

A composite translates as a whole. Marking one of its subfields is rejected when the collection
loads - there is no half-translated repeater item.

Flipping an existing field to translatable is safe: the next [sync](./sync.md) moves its stored
values to the default locale, so nothing is lost.

## Configuring locales

The locale set and its default live in `ohne.config.ts`:

```ts
export default {
  collections: {
    locales: ['en', 'de', 'bs'],
    defaultLocale: 'en',
  },
};
```

Both default to `en`. Every tag is a BCP-47 code, canonicalized for you (`de-at` becomes `de-AT`).
`defaultLocale` must be a member of `locales` - the config errors loudly rather than guessing.

After codegen, `.locale()` narrows to exactly this set: `.locale('fr')` on the config above is a
compile error.

## Reading

`.locale(code)` scopes the whole chain. It exists only on collections with a translatable field,
and once per chain - a query reads one locale. There is no multi-locale read: fetching every
translation of a record is one query per configured locale.

Which locales a record holds is a read-only system field, `_translations`: the held locales in
configured order, `[]` when none. Every record of a translatable collection carries it, whichever
locale you read at, unless a `select` leaves it out. It lists, never filters:
to find untranslated records, read at that locale and test for `null`, as below.

```ts
const post = await query('Posts').locale('de').findFirst();
```

Without `.locale()`, the query reads the default locale. The two lines below are the same read:

```ts
await query('Posts').findMany();
await query('Posts').locale('en').findMany(); // defaultLocale: 'en'
```

A record does not need a translation to exist. Where the queried locale holds none, its
translatable fields read `null`, its translatable lists read `[]` - the record still comes back,
its plain fields intact. Nothing falls back to another locale silently; if you want the English
title when the German one is missing, read it and say so:

```ts
post.title ?? fallback.title;
```

Because a missing translation reads `null`, a translatable scalar or `record` field admits `isNull`,
whatever its own nullability. Translatable composites and lists read `[]` instead, so you probe them
with `empty()`. That is also how you find untranslated records:

```ts
const untranslated = await query('Posts')
  .locale('de')
  .where('title', (w) => w.isNull())
  .findMany();
```

Filters, ordering, and `pluck` on translatable fields all act on the queried locale's values.
`populate` follows the query's locale into the target: a populated author reads its own
translatable fields at the same locale.

## Writing

A write lands on the chain's locale - explicit, or the default:

```ts
await query('Posts').create({ title: 'Hello' }); // stores title under 'en'

await query('Posts')
  .locale('de')
  .where('UUID', post.UUID)
  .update({ title: 'Hallo' }); // stores title under 'de'
```

That update is also how a translation comes to exist: a matched record without a German entry gets
one. Fields your input omits fill from their defaults - and a translatable field that is neither
provided, defaulted, nor nullable fails the call with `required`, since the new entry could not
satisfy it. The answered record's `_translations` lists the locale just written.

An update that touches no translatable field changes nothing about translations: records missing
one keep missing it.

## Copying a translation

When the [collections API](../api/collections.md) exposes a collection's `update`,
`POST /collections/posts/[uuid]/translations/copy` copies a record's translatable values from one
locale onto another, and the dashboard copies a translation through it. To change what a copy
writes, give the collection a `copyTranslation` function. It receives the `source` record, the
default `input`, the `sourceLocale`, and the `targetLocale`, and returns the input to write:

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

A copied translation now starts unpublished. Whatever the function returns, only translatable
fields that are writable and not `immutable` write, so a copy never touches a value shared across
locales.

## Deleting translations

A locale-scoped chain swaps `delete` for `deleteTranslation`:

```ts
const { deleted } = await query('Posts')
  .locale('de')
  .where('status', 'archived')
  .deleteTranslation();
```

It removes the matched records' German values and German list items - the records themselves and
every other locale survive. `deleted` counts the records that actually held something in German.

`delete` stays on the unscoped chain, where its meaning is unambiguous: it removes whole records,
every locale included.

```ts
await query('Posts').where('status', 'spam').delete();
```

## Uniqueness per locale

`unique` on a translatable field spans every locale: a value taken in German is taken in English
too. When each locale should have its own namespace, add `uniquePerLocale`:

```ts
fields: {
  slug: field('text', { translatable: true, unique: true, uniquePerLocale: true }),
}
```

Now `hello` can be the English slug of one post and the German slug of another, but never two
German slugs at once.

## Over HTTP

The wire mirror carries the locale as a query parameter; see
[querying over HTTP](../api/url-queries.md#locales). The [collections API](../api/collections.md)
answers `_translations` on every record, narrowed to the locales the operation's `access` scope
admits, and `GET /collections/posts/[uuid]/translations` lists the same set for one record.
