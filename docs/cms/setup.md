# The CMS

`@ohnejs/cms` turns your ohne app into the CMS for a website. You build the website with any
framework: Nuxt, Next, React, or plain HTML. Your editors edit its pages in the dashboard, with the
live website beside the form.

Install it, and list it as a [layer](../project/layers.md#consuming-a-layer) after `ohnejs/uploads`:

```sh
pnpm add @ohnejs/cms
```

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: {
      Pages: '/[...slug]',
      Posts: '/blog/[slug]',
    },
  },
});
```

`site` is where your website lives. The `SITE_URL` [environment variable](../project/env.md)
overrides it, so each environment can point at its own website.

`routes` says which paths show which collection. A collection named there needs the page fields,
which come next.

## Pages

`pageFields()` adds the fields a collection with a route needs:

- `slug` - the part of the path that finds the record. No two records share one.
- `status` - `draft` or `published`.
- `publishedAt` and `expiresAt` - an optional window the page shows in.
- `seo` - the page's title, description, and image for search engines. See
  [SEO and redirects](./seo.md).

`publishedScope` is the matching [read scope](../api/collections.md#the-scope): a visitor reads
only published records inside their window.

```ts
// collections/Pages.ts
import { pageFields, publishedScope } from '@ohnejs/cms';
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    content: field('blocks', { allow: ['Hero', 'Text'] }),
  },
  api: { read: { public: true, access: publishedScope } },
});
```

An editor with the `cms.drafts` [capability](../auth/roles.md#capabilities) reads every record,
drafts included.

For a collection with [translations](../database/translations.md), pass
`pageFields({ translatable: true })`. Each locale then has its own slug and SEO.

## Routes

A route is a path pattern:

- `[slug]` matches one segment: `/blog/[slug]` matches `/blog/hello`.
- `[...slug]` matches several: `/[...slug]` matches `/about` and `/about/team`, whose slug is
  `about/team`.
- A pattern with no parameter, like `/contact`, is for a
  [singleton](../database/collections.md#singletons): it shows its one record.

Under `/[...slug]`, these slugs are special:

- `index` is the home page. It shows at `/`, and `/index` redirects there.
- `404` is the page your website shows when nothing else matches.

### Routes per locale

With several [locales](../database/translations.md#configuring-locales), give a route per locale:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    site: 'https://example.com',
    routes: {
      Pages: '/[...slug]',
      Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
    },
  },
});
```

A single pattern, like the one for `Pages`, applies to every locale.

The default locale has no prefix, and the others do. Here `/blog/hello` and `/de/artikel/hallo`
are the same post. Set `prefixDefaultLocale: true` to prefix every locale.

## The live editor

In the dashboard, a record of a collection with a route opens in the live editor:

- the blocks on the left, as a tree you can drag, copy, and paste,
- your website in the middle, framed at the record's page,
- the selected block's fields, or the record's own, on the right.

Every keystroke shows on the website before you save. Click a block on the website to select it,
and use its toolbar to move, add, duplicate, or delete it.

The website takes part through a small client. [Your website](./website.md) shows how.

## Sharing a preview

The Share button makes a link to the page as it looks right now, unsaved changes included. Anyone
with the link can see it, no account needed. Later edits do not show in it.

You can share a page you may edit, once it has been saved.

A link lasts as long as you pick, or until an editor of the record revokes it. `cms.share` sets
the choices:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]' },
    share: {
      durations: ['1h', '1d', '14d'],
      default: '1h',
    },
  },
});
```

Leave out `default` and the first duration is picked. Without `cms.share`, the choices are `1h`,
`1d`, `7d`, and `30d`, with `1d` picked first.
