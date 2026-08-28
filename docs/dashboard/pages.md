# Dashboard pages

The dashboard is your app's browser UI, served by ohne itself. There is no build step: your `.ts`
files ship to the browser as type-stripped JavaScript - the same stripping Node uses to run
TypeScript, pointed at the browser. You write a page, save, and the browser reloads.

A page is one file under `dashboard/pages/`, exporting a component:

```ts
// dashboard/pages/index.ts
import { defineDashboardPage, h } from 'ohne/dashboard';

export default defineDashboardPage(() => h('h1', null, 'Hello'));
```

`pnpm exec ohne dev` serves it at `http://localhost:9000`, alongside the API.

## From file to route

The file's path under `pages/` is the route. A trailing `index` collapses, `[name]` declares a
param, `[...name]` a catch-all:

- `pages/index.ts` becomes `/`
- `pages/authors.ts` becomes `/authors`
- `pages/authors/[id].ts` becomes `/authors/[id]`
- `pages/files/[...path].ts` becomes `/files/[...path]`

Every `.ts` file under `pages/` is a page - a `_` prefix is not a helper marker here. Shared
components live outside `pages/`, elsewhere in the dashboard directory (below). Two files in one
layer that resolve to the same route are an error - one would silently shadow the other. Between
layers, the closer layer's page wins; see [layers](../project/layers.md).

## The page component

`defineDashboardPage` takes a function of the route context and returns it unchanged - it exists so
the file's default export is typed. The context carries `params`, the matched route's params
already URI-decoded, and `path`, the matched location path.

```ts
// dashboard/pages/authors/[id].ts
import { defineDashboardPage, h } from 'ohne/dashboard';

export default defineDashboardPage((route) => h('h1', null, `Author ${route.params.id}`));
```

What the component returns and how it updates is the runtime's story:
[rendering](./rendering.md) for `h`, `each`, and `when`, [reactivity](./reactivity.md) for state,
[data](./data.md) for fetching from your API.

## Navigation

The dashboard is a single-page app. The server answers every path with the same shell, so a deep
link loads directly; from there the client router owns navigation. A plain `<a href="/authors">`
just works - a same-origin left-click is intercepted and swaps the page in place, as do the back
and forward buttons. Programmatic navigation is one call:

```ts
import { navigate } from 'ohne/dashboard';

navigate('/authors/42');
```

The most specific matching route wins, and a page's module loads on demand the first time its
route matches. An unmatched path renders the dashboard's not-found page.

## What a page may import

The shell injects an import map with exactly three entries:

- `ohne/dashboard` - the browser runtime: `defineDashboardPage`, `h`, `api`, `useT`, ...
- `ohne/utils` - the isomorphic utility barrel, the same one your Node code imports.
- `app/` - your dashboard directory, so `app/components/nav.ts` is `dashboard/components/nav.ts`.

Relative imports work too. Either way, name the full file, extension included - the browser
resolves URLs, not packages. `app/` merges every layer's dashboard directory, closest layer first,
so an app file shadows a layer's file at the same path.

That map is the whole boundary: the server serves only the dashboard runtime and the utils, never
the Node framework, so browser code cannot import server code - `ohne` is not in the map, and
`useDatabase` has no place in a page. Data crosses over HTTP, through [`api`](./data.md). And
since the browser fetches modules by URL, everything in the dashboard directory is public.

## Serving

`ohne dev` serves the dashboard as a second process beside the API, with live reload: saving a
dashboard file reloads the connected browsers and leaves the API running - nothing under the
dashboard directory restarts it. In production, [`ohne serve dashboard`](../project/cli.md)
serves the same thing without the reload channel.

Port, host, and the API base URL the browser talks to sit under `dashboard.*` in
[config](../project/config.md).

## Type checking

Dashboard code is browser code - DOM types, no `node:` imports - so it type-checks as its own
program. The scaffold's root `tsconfig.json` excludes `dashboard/`; the directory carries its own:

```json
{
  "extends": "ohne/tsconfig.browser.json",
  "include": ["**/*.ts", "../.ohne/shared/**/*.ts", "../.ohne/browser/**/*.ts"]
}
```

`ohne/tsconfig.browser.json` brings the DOM lib; the two `../.ohne` globs bring the generated
types - the typed `api` route ids and message keys. The dashboard server warns at boot when the
file is missing, printing exactly this content.
