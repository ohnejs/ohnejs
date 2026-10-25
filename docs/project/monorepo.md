# Monorepo

Keep your ohne app and your website in one repository. You install once, start both with one
command, and deploy each on its own.

The ohne app is your backend: the API and the dashboard, plus the [CMS](../cms/setup.md) if you add
it. The website is a Nuxt or Next app that reads from that API. The repository holds both, side by
side:

```text
my-site/
├── apps/
│   ├── backend/          your ohne app
│   └── web/              your Nuxt or Next website
├── .gitignore
├── package.json
└── pnpm-workspace.yaml
```

## Creating it

One command creates the whole repository:

```sh
pnpm create ohne@latest my-site --web nuxt
```

- `--web next` creates a Next website instead.
- It needs pnpm, since the repository is a pnpm workspace.
- In a terminal, you can leave `--web` out and pick the website when it asks.

Then start both apps, as in [Running](#running). The sections below set up the same layout by
hand, one file at a time.

## The workspace

Start with the root. It makes the two apps one [pnpm workspace](https://pnpm.io/workspaces):

`package.json`

```json files
{
  "name": "my-site",
  "private": true,
  "scripts": {
    "build": "pnpm --filter web build",
    "dev": "pnpm --recursive --parallel dev",
    "typecheck": "pnpm --recursive typecheck"
  },
  "packageManager": "pnpm@11.5.1"
}
```

`pnpm-workspace.yaml`

```yaml files
packages:
  - apps/*
```

`.gitignore`

```gitignore files
node_modules/
```

- `pnpm dev` starts both apps.
- `pnpm build` builds the website. The backend has nothing to build.
- `pnpm typecheck` checks both.

## The backend

Scaffold an ohne app into `apps/backend`:

```sh
pnpm create ohne@latest apps/backend --yes
```

It is a regular ohne app, so the rest of these docs apply to it unchanged. Run an `ohne` command in
it from the root with `pnpm --filter backend exec`:

```sh
pnpm --filter backend exec ohne sync
```

Keep `web` beside `backend`, never inside it. `ohne dev` reloads on every `.ts` file in its folder,
and its `tsconfig.json` would check the website too.

## A Nuxt website

Create `apps/web` with these files:

`apps/web/package.json`

```json files
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "postinstall": "nuxt prepare",
    "preview": "nuxt preview",
    "typecheck": "nuxt typecheck"
  },
  "dependencies": {
    "nuxt": "4.6.2",
    "vue": "3.5.44",
    "vue-router": "5.4.0"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vue-tsc": "3.3.13"
  }
}
```

`apps/web/nuxt.config.ts`

```ts files
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  runtimeConfig: { public: { ohneAPI: 'http://localhost:9001' } },
});
```

`apps/web/tsconfig.json`

```json files
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

`apps/web/.gitignore`

```gitignore files
.nuxt/
.output/
.data/
.env
```

- `ohneAPI` is your API in development. In production, `NUXT_PUBLIC_OHNE_API` replaces it.
- The website stays on TypeScript 6, since `vue-tsc` and Vue's compiler need TypeScript's
  JavaScript API, which version 7 does not have. The backend stays on 7.

Nuxt installs esbuild, which runs an install script. pnpm refuses it until you allow it in the root
`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*

allowBuilds:
  esbuild: true
```

## A Next website

Create `apps/web` with these files:

`apps/web/package.json`

```json files
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "start": "next start",
    "typecheck": "next typegen && tsc"
  },
  "dependencies": {
    "next": "16.4.2",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "devDependencies": {
    "@types/node": "26.0.0",
    "@types/react": "19.3.0",
    "typescript": "7.0.2"
  }
}
```

`apps/web/next.config.ts`

```ts files
import type { NextConfig } from 'next';

export default {} satisfies NextConfig;
```

`apps/web/tsconfig.json`

```json files
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

`apps/web/app/layout.tsx`

```tsx files
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/.gitignore`

```gitignore files
.next/
next-env.d.ts
*.tsbuildinfo
.env*
```

- `next typegen` writes the types `tsc` reads, like `LayoutProps`, so `pnpm typecheck` works on a
  fresh clone.
- `next build` leaves this `tsconfig.json` as it is. Drop an option, and the build writes it back.

## Running

Install from the root, then start both apps:

```sh
pnpm install
pnpm dev
```

The dashboard opens at `http://localhost:9000`, the API at `http://localhost:9001`, and the website
at `http://localhost:3000`.

When a port is busy, `ohne dev` and Nuxt move to the next free one, and the addresses above stop
matching. Free the port and run `pnpm dev` again.

## Calling the API

The website reads from the [routes](../api/routes.md) your backend defines. In Nuxt, a page's
`<script setup>` takes the address from the runtime config:

```ts
const api = useRuntimeConfig().public.ohneAPI;
const { data: posts } = await useFetch(`${api}/posts`);
```

In Next, a server component reads it from the environment:

```ts
const api = process.env.OHNE_API ?? 'http://localhost:9001';
const response = await fetch(`${api}/posts`, { cache: 'no-store' });
const posts = await response.json();
```

- Next renders these calls on the server, where CORS does not apply.
- Nuxt makes the same call in the browser once the visitor moves to another page. Allow the
  website's origin in the API's [CORS policy](../api/middleware.md#cors), like
  `http://localhost:3000` in development.
- Origins match exactly. A website opened at `127.0.0.1:3000` is a different origin from
  `localhost:3000`.

## Adding the CMS

When your backend is the CMS for this website, add the layer to it, and your framework's package
to the website:

```sh
pnpm --filter backend add @ohnejs/cms
pnpm --filter web add @ohnejs/nuxt @ohnejs/client
```

For a Next website, add `@ohnejs/next` instead of `@ohnejs/nuxt`.

Set it up as in [The CMS](../cms/setup.md), with one more key, `types`:

```ts
// apps/backend/ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  cms: {
    site: 'http://localhost:3000',
    routes: { Pages: '/[...slug]' },
    types: '../web/ohne.ts',
  },
});
```

The CMS now writes your website's [types](../cms/website.md#types) to `apps/web/ohne.ts`. It
rewrites the file while `ohne dev` runs, whenever you change a collection or a block, and on every
`pnpm install`.

- Commit `ohne.ts`. The website then builds without the backend, even on a host that installs
  `apps/web` alone.
- The website reads the CMS through its own server, so the CMS needs no CORS step.
- Uploaded files land in `apps/backend/.uploads/`. Add `.uploads/` to the root `.gitignore`.
- [Frameworks](../cms/frameworks.md) sets up the package, the page and its components.

In CI, check that someone who changed a block also committed the new types:

```sh
pnpm --filter backend exec ohne prepare
git diff --exit-code apps/web/ohne.ts
```

## Deploying

Each app deploys on its own:

- The backend deploys like [any ohne app](../production/deployment.md), from `apps/backend`. With
  the CMS, set `SITE_URL` to the website's public address.
- A Nuxt website builds with `pnpm --filter web build` and runs as
  `node apps/web/.output/server/index.mjs`, with `NUXT_PUBLIC_OHNE_API` set to your API. With the
  CMS, set `NUXT_OHNE_API` too.
- A Next website builds with `pnpm --filter web build` and runs as `pnpm --filter web start`, with
  `OHNE_API` set to your API.

Only the backend needs Node 26. The website runs on any version its framework supports.
