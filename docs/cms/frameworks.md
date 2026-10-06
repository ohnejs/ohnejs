# Frameworks

Each recipe is the whole loop for one framework: read the page, handle redirects and `404`s,
fill the `<head>`, and join the [live preview](./website.md#live-preview). Replace the block markup
with your own components.

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
import { connect, createOhne } from '@ohnejs/client';
import { Hero, Text } from '#components';

const blocks = { Hero, Text };
const api = useRuntimeConfig().public.ohneAPI;
const ohne = createOhne({ api });
const route = useRoute();
const token = useState('ohne-preview', () => route.query['ohne-preview'] as string | undefined);

const { data: page } = await useAsyncData(`ohne:${route.path}`, () =>
  ohne.resolve(route.path, { token: token.value }),
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
  const preview = connect({ api, onData: (next) => (page.value = next) });
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
          ...page.value.alternates.map((link) => ({ rel: 'alternate', ...link })),
        ]
      : [],
});
</script>

<template>
  <main v-if="page?.kind === 'page'">
    <h1>{{ page.record.title }}</h1>
    <component
      :is="blocks[block.block as keyof typeof blocks]"
      v-for="block in page.record.content as any[]"
      :key="block.UUID"
      :data-ohne-block="block.UUID"
      v-bind="block.fields"
    />
  </main>
</template>
```

`onData` swaps in each new page as the editor types, with no request. `useState` keeps the token
across renders, since the client removes it from the address bar.

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

import { Preview } from '../../components/preview';

const api = process.env.NEXT_PUBLIC_OHNE_API!;
const ohne = createOhne({ api, fetchInit: { cache: 'no-store' } });

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ 'ohne-preview'?: string }>;
};

async function load({ params, searchParams }: Props) {
  const { slug = [] } = await params;
  const token = (await searchParams)['ohne-preview'];
  const page = await ohne.resolve(`/${slug.join('/')}`, { token });
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

export default async function Page(props: Props) {
  const { page, token } = await load(props);
  const blocks = (page.record.content ?? []) as { block: string; UUID: string; fields: any }[];
  return (
    <main>
      <h1>{String(page.record.title)}</h1>
      {blocks.map((block) => (
        <section key={block.UUID} data-ohne-block={block.UUID}>
          {block.fields.heading}
        </section>
      ))}
      {token && <Preview api={api} />}
    </main>
  );
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
    ohne.resolve(location.pathname, { token }).then((next) => {
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

Search engines read a page rendered in the browser poorly. Prefer a server-rendered framework for
a public site.

## Any server

Without a framework, render the HTML on the server. `renderHead` writes the `<head>` tags.
`previewScript` loads the client at the end of `<body>`; on each change it fetches the page again
and swaps the `<body>` in:

```js
// server.js
import { createServer } from 'node:http';

import { createOhne, escapeHTML } from '@ohnejs/client';

const ohne = createOhne({ api: process.env.OHNE_API });

createServer(async (request, response) => {
  const path = new URL(request.url, 'http://site').pathname;
  const token = ohne.token(request.url);
  const page = await ohne.resolve(path, { token });

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
      `<section data-ohne-block="${block.UUID}">${escapeHTML(block.fields.heading)}</section>`,
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
