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

In `record`, each [block](../database/blocks.md) reads as `{ block, UUID, fields }`. Upload URLs
are absolute, so they work from another origin. A related record with a route of its own carries
its `path`, so you can link to it.

## Rich text and links

A [rich text](../database/rich-text.md) value is a tree of blocks, never HTML. `richTextToHTML`
renders it, with every text and address escaped:

```ts
import { richTextToHTML, type RichText } from '@ohnejs/client';

const html = richTextToHTML(page.record.body as RichText);
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
const page = await ohne.resolve(location.pathname, { token });

render(page);
if (token) connect({ api, onData: render });
```

`render` is your own function that draws a page.

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
