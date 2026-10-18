# Frameworks

Each recipe is the whole loop for one framework: read the page, handle redirects and `404`s,
fill the `<head>`, and join the [live preview](./website.md#live-preview). Nuxt and Next have a
package that runs it for you. React and any other server build it from `@ohnejs/client`.

The TypeScript recipes read their [types](./website.md#types) from `ohne.ts`, for a `Pages`
collection whose `content` holds `Hero` and `Text` blocks.

## Nuxt

[`@ohnejs/nuxt`](https://github.com/ohnejs/nuxt) is a Nuxt module that runs the whole loop. Install
it with the client:

```sh
pnpm add @ohnejs/nuxt @ohnejs/client
```

List the module and name your API:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@ohnejs/nuxt'],
  ohne: { api: 'https://api.example.com' },
});
```

- Only the server reads `ohne.api`, so it may be a private address. The browser reads through your
  site's own `/_ohne` routes.
- `NUXT_OHNE_API` replaces it when the server starts, so one build serves every environment.
- The module types every page from the `ohne.ts` next to `nuxt.config.ts`.

One catch-all page renders every path:

```vue
<!-- app/pages/[...slug].vue -->
<script setup lang="ts">
definePageMeta({ middleware: 'ohne' });

const page = useOhnePage();
</script>

<template>
  <main v-if="page?.kind === 'page' && page.collection === 'Pages'">
    <h1>{{ page.record.title }}</h1>
    <OhneBlocks :blocks="page.record.content" />
  </main>
  <main v-else-if="page?.kind === 'notFound' && page.page">
    <h1>{{ page.page.title }}</h1>
    <OhneBlocks :blocks="page.page.content" />
  </main>
</template>
```

The `ohne` middleware resolves the path and its query once, on the server:

- A page fills `useOhnePage()`. Checking `collection` narrows `record` to that collection's fields.
- A redirect answers with its own code, and renders nothing.
- A miss answers `404` with your [`404` page](./setup.md#routes), and a failing API `502`.

The module also fills the `<head>`, keeps a preview out of caches and search engines, joins the
live preview, and serves `/sitemap.xml` and `/robots.txt`.

`OhneBlocks` renders each block with the component of the same name in `app/components/blocks/`. A
block component takes the block's fields as `fields`:

```vue
<!-- app/components/blocks/Hero.vue -->
<script setup lang="ts">
import type { Blocks } from '~~/ohne';

defineProps<{ fields: Blocks['Hero'] }>();
</script>

<template>
  <section>
    <h2>{{ fields.heading }}</h2>
    <OhneRichText :value="fields.body" />
  </section>
</template>
```

`Text.vue` is the same with `Blocks['Text']`, rendering only
`<OhneRichText :value="fields.body" />`.

- The root element gets `data-ohne-block`, so the editor can select the block. Keep one root.
- `OhneRichText` sends clicks on links to your pages through `navigateTo`. `OhneLink` renders a
  `link` field as a `NuxtLink`.
- `nuxt typecheck` names a block that has no component.

`nuxt typecheck` runs `vue-tsc`, which needs TypeScript 6, so keep your Nuxt app on it. The module's
[README](https://github.com/ohnejs/nuxt#readme) covers layouts and reading other paths.

## Next

[`@ohnejs/next`](https://github.com/ohnejs/next) runs the whole loop in the App Router. Install it
with the client:

```sh
pnpm add @ohnejs/next @ohnejs/client
```

Create the connection once:

```ts
// lib/ohne.ts
import { createOhneNext } from '@ohnejs/next';

import type { CMS } from '../ohne';

export const ohne = createOhneNext<CMS>({ api: process.env.OHNE_API ?? 'http://localhost:9001' });
```

`OHNE_API` is your API's address. The server reads it when it runs, so one build serves every
environment, and it may be a private address.

Every page request passes through the proxy:

```ts
// proxy.ts
import { ohne } from './lib/ohne';

export const proxy = ohne.proxy;

export const config = { matcher: '/((?!_next/).*)' };
```

It hands each page its path and query, keeps a preview out of caches and search engines, and serves
the editor's script under `/_ohne/`, so keep the `matcher` covering that.

One catch-all page renders every path:

```tsx
// app/[[...slug]]/page.tsx
import { OhneBlocks } from '@ohnejs/next';

import { Hero } from '../../components/hero';
import { Text } from '../../components/text';
import { ohne } from '../../lib/ohne';

export const generateMetadata = ohne.metadata;

export default async function Page() {
  const { page } = await ohne.page();
  return (
    <main lang={page.locale}>
      <h1>{page.record.title}</h1>
      <OhneBlocks blocks={page.record.content} components={{ Hero, Text }} />
    </main>
  );
}
```

- `ohne.page()` resolves the address. A permanent redirect answers `308`, a temporary one `307`, and
  a miss `404`.
- `ohne.metadata` fills the title, description, share tags, robots, canonical and `hreflang` links.
- `components` must name a component for every block, so a block the CMS adds fails the typecheck.

A miss renders the not-found page beside it, with your [`404` page](./setup.md#routes):

```tsx
// app/[[...slug]]/not-found.tsx
import { OhneBlocks } from '@ohnejs/next';

import { Hero } from '../../components/hero';
import { Text } from '../../components/text';
import { ohne } from '../../lib/ohne';

export default async function NotFound() {
  const { resolved } = await ohne.current();
  const page = resolved.kind === 'notFound' ? resolved.page : undefined;
  return (
    <main>
      <h1>{page?.title ?? 'Page not found'}</h1>
      <OhneBlocks blocks={page?.content} components={{ Hero, Text }} />
    </main>
  );
}
```

The root layout joins the live preview. Outside the editor's frame, `OhnePreview` does nothing:

```tsx
// app/layout.tsx
import { OhnePreview } from '@ohnejs/next/client';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        {children}
        <OhnePreview />
      </body>
    </html>
  );
}
```

Each block component takes its block:

```tsx
// components/hero.tsx
import { OhneRichText } from '@ohnejs/next/client';

import type { Block } from '../ohne';

export function Hero({ fields }: Block<'Hero'>) {
  return (
    <section>
      <h2>{fields.heading}</h2>
      <OhneRichText value={fields.body} />
    </section>
  );
}
```

`text.tsx` is the same with `Block<'Text'>`, rendering only `<OhneRichText value={fields.body} />`.

- `OhneBlocks` wraps each block in a `<div>` with `data-ohne-block`, so the editor can select it.
- `OhneRichText` sends clicks on links to your pages through Next's router. `OhneLink` renders a
  `link` field as Next's `Link`.

Two route handlers serve the sitemap and `robots.txt` at your site's root:

```ts
// app/sitemap.xml/route.ts
import { ohne } from '../../lib/ohne';

export const GET = ohne.sitemap;
```

```ts
// app/robots.txt/route.ts
import { ohne } from '../../lib/ohne';

export const GET = ohne.robots;
```

The package's [README](https://github.com/ohnejs/next#readme) covers caching, with a route for
[webhooks](./webhooks.md) that drops the cache when content changes.

## React

A page rendered in the browser fetches itself, and takes each new page from `onData`:

```jsx
// src/page.jsx
import { connect, createOhne } from '@ohnejs/client';
import { useEffect, useState } from 'react';

const api = import.meta.env.VITE_OHNE_API;
const ohne = createOhne({ api });
const token = ohne.token(location.href);

export function Page() {
  const [page, setPage] = useState();

  useEffect(() => {
    ohne.resolve(location.pathname + location.search, { token }).then((next) => {
      if (next.kind === 'redirect') location.replace(next.to);
      else setPage(next);
    });
    if (token) return connect({ api, onData: setPage }).dispose;
  }, []);

  useEffect(() => {
    if (page?.kind === 'page') document.title = page.seo.title;
  }, [page]);

  if (!page) return null;
  if (page.kind === 'notFound') return <h1>Not found</h1>;
  return (
    <main>
      <h1>{page.record.title}</h1>
      {page.record.content?.map((block) => (
        <section key={block.UUID} data-ohne-block={block.UUID}>
          {block.fields.heading}
        </section>
      ))}
    </main>
  );
}
```

A [rich text](./website.md#rich-text-and-links) field renders through one component. The recipe
has no router, so a link to another page loads it like any other link:

```jsx
// src/rich-text.jsx
import { richTextToHTML } from '@ohnejs/client';

export function RichText({ value }) {
  return <div dangerouslySetInnerHTML={{ __html: richTextToHTML(value) }} />;
}
```

The page renders a field with `<RichText value={block.fields.body} />`.

Search engines read a page rendered in the browser poorly. Prefer a server-rendered framework for
a public site.

## Any server

Without a framework, render the HTML on the server. `renderHead` writes the `<head>` tags, and
`richTextToHTML` renders a [rich text](./website.md#rich-text-and-links) field. `previewScript`
loads the client at the end of `<body>`; on each change it fetches the page again and swaps the
`<body>` in:

```js
// server.js
import { createServer } from 'node:http';

import { createOhne, escapeHTML, richTextToHTML } from '@ohnejs/client';

const ohne = createOhne({ api: process.env.OHNE_API });

createServer(async (request, response) => {
  const token = ohne.token(request.url);
  const page = await ohne.resolve(request.url, { token });

  if (page.kind === 'redirect') {
    response.writeHead(page.code, { location: page.to }).end();
    return;
  }
  if (page.kind === 'notFound') {
    response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    return;
  }

  const blocks = (page.record.content ?? []).map(
    (block) =>
      `<section data-ohne-block="${block.UUID}">
        <h2>${escapeHTML(block.fields.heading)}</h2>
        ${richTextToHTML(block.fields.body)}
      </section>`,
  );
  response.writeHead(200, {
    'content-type': 'text/html',
    ...(token ? ohne.previewHeaders() : {}),
  });
  response.end(`<!doctype html>
<html>
  <head>${ohne.renderHead(page, { token })}</head>
  <body>
    <h1>${escapeHTML(page.record.title)}</h1>
    ${blocks.join('')}
    ${token ? ohne.previewScript() : ''}
  </body>
</html>`);
}).listen(3000);
```
