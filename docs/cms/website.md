# Your website

Your website reads its pages from the CMS with [`@ohnejs/client`](https://github.com/ohnejs/client).
It has no dependencies and runs wherever `fetch` does.

```sh
pnpm add @ohnejs/client
```

## Reading a page

Ask the CMS which page a path shows:

```ts
import { createOhne } from '@ohnejs/client';

const ohne = createOhne({ api: 'https://api.example.com' });
const page = await ohne.resolve('/blog/hello');
```

`api` is your ohne app's API URL. The answer's `kind` is one of:

- `page` - render `record`. Put `seo` and `alternates` in the `<head>`.
- `redirect` - send the visitor to `to`, with the status `code`.
- `notFound` - answer with a `404` status. When your site has a [`404` page](./setup.md#routes),
  `page` holds its record.

In `record`, each [block](../database/blocks.md) reads as `{ block, UUID, fields }`.

- Every image and file arrives as an upload, wherever it sits: `UUID`, `name`, `type`, `size`,
  `width`, `height`, `description`, `focalX`, `focalY`, an absolute `url`, and `variants` when
  [named variants](../uploads/image-variants.md#named-variants) are set.
- A private file or a folder reads `null`, or drops out of its list.
- Any other relation loads one level deep. A related record keeps its own relations as `UUID`s,
  and carries its `path` when it has a route.
- A related record shows exactly what its collection's read access shows the visitor. To hide a
  field from the site, narrow that access with [`select`](../api/collections.md#the-scope) or mark
  the field [`readable: false`](../database/collections.md#write-only-and-locked-fields).
- The types follow that access: a narrowed collection is typed with its selected fields alone.
- A read's [`middleware`](../api/collections.md#exposure) guards the resolve too. The types cannot
  run middleware without a request, so they leave such a collection out and warn you.
- A translatable value, an upload's `description` included, reads `null` in a locale without a
  translation. The CMS never substitutes another language, so fall back on the site, as in
  `upload.description ?? ''`.

## Site data

Not everything on your site is a page. A menu, a footer, or a list of posts lives in records you
read by collection name. Here the menu sits in a [singleton](../database/collections.md#singletons):

```ts
// collections/Settings.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  singleton: true,
  api: { read: 'public', update: true },
  fields: {
    copyright: field('text', { default: '' }),
    menu: field('repeater', {
      fields: {
        label: field('text'),
        link: field('link', { collections: ['Pages'], nullable: true }),
      },
    }),
  },
});
```

`read` and `list` take the collection's name:

```ts
const settings = await ohne.read('Settings');
const post = await ohne.read('Posts', uuid);
const posts = await ohne.list('Posts', { order: ['-publishedAt'], page: 2 });
```

- `read` with a name alone reads a singleton's record.
- `read` with a `UUID` reads that record, or answers `undefined` when the visitor may not see it.
- `list` answers one page: `{ records, total, page, perPage, lastPage }`. Omitted, `perPage` is
  `20`, and it takes at most `100`.

`list` takes the [URL query](../api/url-queries.md) as options:

```ts
const posts = await ohne.list('Posts', {
  where: { title: { contains: 'ohne' } },
  order: ['-publishedAt'],
  select: ['title', 'publishedAt'],
  locale: 'de',
});
```

- [`where`](../api/url-queries.md#filtering) keeps the matching records.
- `select` narrows the fields. `UUID` and `path` come whatever it names.
- `locale` picks the language. Omitted, records read in your default locale.
- A `read` takes `select` and `locale` too.

You read as a visitor does, so the collection's read access decides what comes back:

- A collection read with `publishedScope` shows only its published records.
- A collection the visitor may not read is missing: `list` and a singleton's `read` throw.
- A `where` never widens the access. It only narrows what the access shows.
- Each record loads as a page's `record` does: uploads with absolute URLs, relations one level
  deep, and links with `href`. A record with a route carries its `path`.
- Reads show saved records, never the editor's unsaved changes. A list in the live preview shows
  what is saved.

## Forms

A contact form, a newsletter sign-up, or a comment box sends a record to your CMS. Open the
collection's create to visitors:

```ts
// collections/Messages.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  api: { create: 'public' },
  fields: {
    name: field('text'),
    email: field('email'),
    message: field('text'),
  },
});
```

Its read stays closed, so anyone may send a message and only your editors read them.

`create` takes the collection's name and the fields:

```ts
const result = await ohne.create('Messages', {
  name: 'Ada',
  email: 'ada@example.com',
  message: 'Hello!',
});

if (!result.ok) console.log(result.errors.email ?? result.message);
```

- A stored create answers `{ ok: true, UUID }`.
- A refusal the visitor can fix answers `ok: false`. Its `status` is `422` for an invalid field,
  `403` when a middleware refuses, and `429` when a rate limit does.
- `message` says what went wrong, and `errors` holds a message per invalid field, like
  `result.errors.email`. Pass the visitor's `Accept-Language` on, and both are in their language.
- Anything else throws, like a collection with no create or an API that does not answer.

A spam check reads a header. Run it as [middleware](../api/middleware.md#route-middleware) on the
create, `create: { public: true, middleware: ['recaptcha'] }`, and pass the header with the create:

```ts
await ohne.create('Messages', message, { headers: { 'recaptcha-token': token } });
```

The [Nuxt and Next](./frameworks.md) packages send the create from your site's server, and pass
each visitor's address on as `X-Forwarded-For`. List that server in
[`api.trustProxy`](../production/deployment.md#behind-a-proxy), so `event.ip` and each
[rate limit](../api/rate-limiting.md#who-counts-as-one-client) see the visitor, not your site.
A Next server passes on the header it receives, so list it only behind a proxy that sets that
header, like your host's.

## Types

The CMS describes its pages as a TypeScript file, `ohne.ts`. Pass its `CMS` type to `createOhne`,
and every page, block, and upload is typed:

```ts
import { createOhne } from '@ohnejs/client';
import type { CMS } from './ohne.ts';

const ohne = createOhne<CMS>({ api: 'https://api.example.com' });
const page = await ohne.resolve('/blog/hello');

if (page.kind === 'page' && page.collection === 'Posts') {
  console.log(page.record.title);
}
```

Checking `collection` narrows `record` to that collection's fields.

It types [site data](#site-data) too. `read` and `list` take only collections a visitor may read.
Their `order`, `select` and `where` take only that collection's fields, and the answer holds the
fields you select.

It types [forms](#forms) as well. `create` takes only collections a visitor may create in, and
checks each field you send. A composite or blocks field takes any value, and the API validates it.

`CMS` describes everything your CMS resolves; `Page`, `Block`, `Blocks`, `Records`, `Creatable`,
`Related` and `Upload` name its parts. `Creatable['Messages']` is what a create in `Messages`
takes. `Block<'Hero'>` is one `Hero` item, and `Block` alone is any block,
narrowed by `block`:

```ts
import { escapeHTML, richTextToHTML } from '@ohnejs/client';
import type { Block, Upload } from './ohne.ts';

function image(upload: Upload | null) {
  if (!upload) return '';
  return `<img src="${escapeHTML(upload.url)}" alt="${escapeHTML(upload.description ?? '')}">`;
}

export function renderHero({ fields }: Block<'Hero'>) {
  return `<h1>${escapeHTML(fields.heading)}</h1>${image(fields.image)}${richTextToHTML(fields.body)}`;
}
```

`Blocks['Hero']` is the `fields` of one `Hero`. Reach for it when a component takes a block's
fields as its props, as Vue's `defineProps` does: it cannot resolve `Block<'Hero'>['fields']`.

A [custom field type](../database/custom-field-types.md#on-your-website) that the website cannot
type reads `unknown`.

### Getting the file

When your website lives in its own repository, download the file from your API and commit it:

```json
{
  "scripts": {
    "ohne:types": "curl -fsS $OHNE_API/cms/types.ts -o ohne.ts"
  }
}
```

Run `pnpm ohne:types` again after you change a collection or a block. Your dev API serves the
same route, so `OHNE_API=http://localhost:9001` works too.

In a [monorepo](../project/monorepo.md#adding-the-cms), set `cms.types` and the CMS writes the file
into your website as you edit.

`/cms/types.ts` is public, like the pages it describes: it shows only what a visitor without a
session can read. Each collection's read access is asked as that visitor, so a collection that
refuses them is left out and a [`select`](../api/collections.md#the-scope) narrows its fields. Such
an access answers without a request, as `publishedScope` does: read the visitor with `useUser`,
never `useEvent`. When your pages are not public,
[override](../api/routes.md#routes-across-layers) `GET /cms/types.ts` in your app and call
`requireUser()` there.

## Rich text and links

A [rich text](../database/rich-text.md) value is a tree of blocks, never HTML. `richTextToHTML`
renders it, with every text and address escaped:

```ts
import { richTextToHTML } from '@ohnejs/client';
import type { Blocks } from './ohne.ts';

export function renderText(text: Blocks['Text']) {
  return richTextToHTML(text.body);
}
```

- A link to a record carries `href` when the reader can open its page: the target is published,
  and its collection has a route in the page's locale. Otherwise the link renders as plain text,
  and comes back once the target does.
- A `link` field's value carries `href` by the same rule.
- Pass `{ inline: true }` for an [`inline`](../database/rich-text.md#options) field.

The rendered links are plain `<a href>` tags. To keep them inside a client-side router, let
`interceptLinks` catch the clicks:

```ts
import { interceptLinks } from '@ohnejs/client';

const dispose = interceptLinks(document, (path) => router.push(path));
```

It leaves alone links to other origins, links that open a new tab, downloads, and clicks with a
modifier key held. Call `dispose` on unmount. [Frameworks](./frameworks.md) shows the component
for each framework.

## Live preview

The editor frames your page with a preview token in the URL, `?ohne-preview=...`. Your page:

1. Passes it to `resolve`, so the CMS answers with the editor's unsaved changes.
2. Connects to the editor, so it hears about each change.

```ts
import { connect, createOhne } from '@ohnejs/client';

const api = 'https://api.example.com';
const ohne = createOhne({ api });
const token = ohne.token(location.href);
const page = await ohne.resolve(location.pathname + location.search, { token });

render(page);
if (token) connect({ api, onData: render });
```

`render` is your own function that draws a page.

A preview carries the editor's unsaved values in the shape of a saved page.

`onData` receives the new page on every change, with no request of your own. A page rendered on
the server passes `onRefresh` instead and renders itself again there. With neither, the client
fetches the page again and swaps in its `<body>`.

`connect` does nothing outside the editor's frame, so it is safe to call everywhere.

[Frameworks](./frameworks.md) shows the whole loop in Nuxt, Next, React, and plain HTML.

## Marking blocks

Give each block's root element a `data-ohne-block` attribute holding its `UUID`. The editor then
outlines it, selects it on click, and shows its toolbar:

```html
<section data-ohne-block="01a10e2a-156a-785e-9eca-3511ba282500">...</section>
```

## Letting the dashboard frame your site

The live editor shows your website in an `<iframe>`. Most frameworks allow that by default. If
your host sends `X-Frame-Options`, or a `Content-Security-Policy` with `frame-ancestors`, allow
your dashboard's origin:

```http
Content-Security-Policy: frame-ancestors https://admin.example.com
```

When the website never answers, the editor says so and lists the usual causes.

## Keeping previews private

A preview shows unsaved work, so no cache or search engine may keep it. While a token is set, send
`ohne.previewHeaders()` with your response, and set the robots meta tag to `noindex`. The recipes
in [Frameworks](./frameworks.md) do both.

A [shared preview](./setup.md#sharing-a-preview) link carries the same `?ohne-preview=` token, so
your website shows it with no change.
