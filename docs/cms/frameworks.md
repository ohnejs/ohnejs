# Frameworks

Each recipe is the whole loop for one framework: read the page, handle redirects and `404`s,
fill the `<head>`, and join the [live preview](./website.md#live-preview). Replace the block markup
with your own components.

The TypeScript recipes read their [types](./website.md#types) from `ohne.ts`, for a `Pages`
collection whose `content` holds `Hero` and `Text` blocks.

## Nuxt

Put the API URL in the runtime config:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: { public: { ohneAPI: 'https://api.example.com' } },
});
```

One catch-all page renders every route:

```vue
<!-- app/pages/[...slug].vue -->
<script setup lang="ts">
import type { Component } from 'vue';

import { connect, createOhne } from '@ohnejs/client';
import { Hero, Text } from '#components';

import type { Block, CMS } from '~~/ohne';

const blocks = { Hero, Text } satisfies Record<Block['block'], Component>;
const api = useRuntimeConfig().public.ohneAPI;
const ohne = createOhne<CMS>({ api });
const route = useRoute();
const token = useState('ohne-preview', () => route.query['ohne-preview'] as string | undefined);
const address = route.fullPath.replace(/#.*/, '');

const { data: page } = await useAsyncData(`ohne:${address}`, () =>
  ohne.resolve(address, { token: token.value }),
);
if (page.value?.kind === 'redirect') {
  await navigateTo(page.value.to, { redirectCode: page.value.code, external: true });
}
if (page.value?.kind !== 'page') throw createError({ status: 404 });

if (import.meta.server && token.value) {
  for (const [name, value] of Object.entries(ohne.previewHeaders())) {
    useResponseHeader(name).value = value;
  }
}

onMounted(() => {
  if (!token.value) return;
  const preview = connect<CMS>({ api, onData: (next) => (page.value = next) });
  onBeforeUnmount(preview.dispose);
});

const seo = computed(() => (page.value?.kind === 'page' ? page.value.seo : undefined));
useSeoMeta({
  title: () => seo.value?.title,
  description: () => seo.value?.description,
  ogImage: () => seo.value?.image,
  robots: () => (token.value ? 'noindex' : seo.value?.robots),
});
useHead({
  link: () =>
    page.value?.kind === 'page'
      ? [
          { rel: 'canonical', href: page.value.seo.canonical },
          ...page.value.alternates.map((link) => ({ rel: 'alternate' as const, ...link })),
        ]
      : [],
});
</script>

<template>
  <main v-if="page?.kind === 'page' && page.collection === 'Pages'">
    <h1>{{ page.record.title }}</h1>
    <component
      :is="blocks[block.block]"
      v-for="block in page.record.content"
      :key="block.UUID"
      :data-ohne-block="block.UUID"
      v-bind="block.fields"
    />
  </main>
</template>
```

`onData` swaps in each new page as the editor types, with no request. `useState` keeps the token
across renders, since the client removes it from the address bar. When you add a block to the CMS,
`satisfies` fails until `blocks` has a component for it.

`address` is the path with its query, which a redirect may keep. The hash stays out, so the key is
the same on the server and in the browser.

A [rich text](./website.md#rich-text-and-links) field renders through one component, which routes
clicks on links to your pages through `navigateTo`:

```vue
<!-- app/components/RichText.vue -->
<script setup lang="ts">
import { interceptLinks, richTextToHTML, type RichText } from '@ohnejs/client';

const props = defineProps<{ value: RichText }>();
const root = useTemplateRef('root');
const html = computed(() => richTextToHTML(props.value));

onMounted(() => {
  const dispose = interceptLinks(root.value!, (path) => navigateTo(path));
  onBeforeUnmount(dispose);
});
</script>

<template>
  <div ref="root" v-html="html" />
</template>
```

Each block is a component that takes its fields as props. `Blocks['Hero']` types them:

```vue
<!-- app/components/Hero.vue -->
<script setup lang="ts">
import type { Blocks } from '~~/ohne';

defineProps<Blocks['Hero']>();
</script>

<template>
  <section>
    <h2>{{ heading }}</h2>
    <RichText :value="body" />
  </section>
</template>
```

`defineProps` cannot resolve `Block<'Hero'>['fields']`, so name the block in `Blocks` instead.

## Next

The page renders on the server. In preview, `router.refresh()` renders it again from the URL, so
`keepToken` leaves the token there:

```tsx
// components/preview.tsx
'use client';

import { connect } from '@ohnejs/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function Preview({ api }: { api: string }) {
  const router = useRouter();
  useEffect(() => connect({ api, keepToken: true, onRefresh: router.refresh }).dispose, [api, router]);
  return null;
}
```

```tsx
// app/[[...slug]]/page.tsx
import type { Metadata } from 'next';

import { createOhne } from '@ohnejs/client';
import { notFound, permanentRedirect, redirect } from 'next/navigation';

import type { Block, CMS } from '../../ohne';

import { Preview } from '../../components/preview';
import { RichText } from '../../components/rich-text';

const api = process.env.NEXT_PUBLIC_OHNE_API!;
const ohne = createOhne<CMS>({ api, fetchInit: { cache: 'no-store' } });

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load({ params, searchParams }: Props) {
  const { slug = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const each of [value].flat()) if (each !== undefined) query.append(key, each);
  }
  const token = query.get('ohne-preview') ?? undefined;
  const page = await ohne.resolve(`/${slug.join('/')}${query.size ? `?${query}` : ''}`, { token });
  if (page.kind === 'redirect') {
    if (page.code === 301 || page.code === 308) permanentRedirect(page.to);
    redirect(page.to);
  }
  if (page.kind === 'notFound') notFound();
  return { page, token };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { page, token } = await load(props);
  return {
    title: page.seo.title,
    description: page.seo.description,
    openGraph: { images: page.seo.image },
    robots: token ? 'noindex' : page.seo.robots,
    alternates: {
      canonical: page.seo.canonical,
      languages: Object.fromEntries(page.alternates.map((link) => [link.hreflang, link.href])),
    },
  };
}

function Content({ block }: { block: Block }) {
  switch (block.block) {
    case 'Hero':
      return <h2>{block.fields.heading}</h2>;
    case 'Text':
      return <RichText value={block.fields.body} />;
  }
}

export default async function Page(props: Props) {
  const { page, token } = await load(props);
  if (page.collection !== 'Pages') notFound();
  return (
    <main>
      <h1>{page.record.title}</h1>
      {page.record.content.map((block) => (
        <section key={block.UUID} data-ohne-block={block.UUID}>
          <Content block={block} />
        </section>
      ))}
      {token && <Preview api={api} />}
    </main>
  );
}
```

The `switch` on `block.block` narrows `fields` to that block's. Narrow on `page.collection` the same
way to render another collection.

Next hands a page its query as an object, with a repeated key as an array, so `load` writes it back
out for `resolve`, which a redirect may keep.

A [rich text](./website.md#rich-text-and-links) field renders through one client component, which
routes clicks on links to your pages through `router.push`:

```tsx
// components/rich-text.tsx
'use client';

import { interceptLinks, richTextToHTML, type RichText as RichTextValue } from '@ohnejs/client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function RichText({ value }: { value: RichTextValue }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => interceptLinks(root.current!, router.push), [router]);
  return <div ref={root} dangerouslySetInnerHTML={{ __html: richTextToHTML(value) }} />;
}
```

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
