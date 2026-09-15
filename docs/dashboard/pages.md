# Dashboard pages

The dashboard is your app's browser UI, served by ohne itself. There is no build step: your `.ts`
files ship to the browser as type-stripped JavaScript - the same stripping Node uses to run
TypeScript, pointed at the browser. You write a page, save, and the browser reloads.

A page is one file under `dashboard/pages/`, exporting a component:

```ts
// dashboard/pages/index.ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage(() => h('h1', null, 'Hello'));
```

`npx ohne dev` serves it at `http://localhost:9000`, alongside the API.

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
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage((route) => h('h1', null, `Author ${route.params.id}`));
```

What the component returns and how it updates is the runtime's story:
[rendering](./rendering.md) for `h`, `each`, and `when`, [reactivity](./reactivity.md) for state,
[data](./data.md) for fetching from your API.

## Navigation

The dashboard is a single-page app. The server answers every path with the same shell, so a deep
link loads directly; from there the client router swaps pages in place. Links, `navigate`, and the
back and forward buttons are covered in [rendering](./rendering.md#navigation). The most specific
matching route wins.

`lastNavigation()` tells a page how it was reached: the initial `load`, a `navigate` call or a
clicked link, or `popstate` for the back and forward buttons. A page that restores a remembered
view when its URL arrives bare checks it first, so going back still lands on the bare view.

## The sidebar

A page is reachable by URL the moment its file exists. To give it a row in the sidebar, list it
under `dashboard.menu` in [config](../project/config.md):

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  dashboard: {
    menu: [
      {
        label: 'Content',
        items: ['Pages', 'Posts', { to: '/reports', label: 'Reports', icon: 'chart-bar' }],
      },
      { label: 'People', items: ['Users'] },
    ],
  },
});
```

A group's `items` hold its rows, in the order you write them.

A **string** names a [collection](../database/collections.md) and renders its list link. The label
and icon come from the collection itself, and the row disappears for a viewer who cannot reach it.

An **object** is a link to any dashboard path: `to`, a `label`, and an optional
[Tabler icon](https://tabler.io/icons). Nothing filters it - the dashboard knows no capability for
a page - so scope one with the [`dashboard:menu`](../api/hooks.md#dashboardmenu) hook.

The group's own `label` is its heading; omit it for a list without one. Both labels take a
[message key](../i18n/messages.md), so a heading and a link translate per viewer:

```ts
{ label: 'menu.content', items: [{ to: '/reports', label: 'menu.reports' }] }
```

Collections you list nowhere trail in a final unlabeled group, and a group left with no row drops.
Omit `menu` and the sidebar leads with the overview row, then lists every accessible collection in
one unlabeled group. A declared `menu` holds only the rows you list, so link to `/overview` yourself
to keep that row.

## Boot files

A dashboard boot file is a `.ts` file at the top level of `dashboard/boot/`. It runs once when the
dashboard loads, by being imported: whatever its module body does happens before the first page
renders. Use it for registrations the pages rely on - a field type, a piece of UI mounted for the
whole dashboard.

```ts
// dashboard/boot/rating.ts
import { registerFieldType } from 'ohnejs/dashboard';

registerFieldType('rating', {
  display: ({ value }) => () => '★'.repeat(Number(value() ?? 0)),
});
```

Files run in the order [server boot files](../project/boot.md#ordering) do: top-level only, sorted
naturally by name, one at a time, `_`-prefixed helpers skipped, and an `index.ts` taking over.

Across [layers](../project/layers.md), the furthest layer boots first, so a base layer's field types
are registered when your boot files run. A boot file's identity is its path: your `boot/fields.ts`
replaces a layer's `boot/fields.ts` and runs in its place.

## What a page may import

The shell injects an import map with these entries:

- `ohnejs/dashboard` - the browser runtime: `defineDashboardPage`, `h`, `api`, `useT`, ...
- `ohnejs/utils` - the isomorphic utility barrel, the same one your Node code imports.
- `app/` - your dashboard directory, so `app/components/nav.ts` is `dashboard/components/nav.ts`.

Relative imports work too. Either way, name the full file, extension included - the browser
resolves URLs, not packages. `app/` merges every layer's dashboard directory, closest layer first,
so an app file shadows a layer's file at the same path. The same merge lets a layer import another
layer's dashboard files by their `app/` path - `app/components/shell.ts` resolves wherever in the
stack the file lives. For the editor to follow, the tsconfig `paths` entry lists your own directory
first, then each stacked layer's dashboard directory; see [type checking](#type-checking).

That map is the whole boundary: the server serves only the dashboard runtime and the utils, never
the Node framework, so browser code cannot import server code - `ohnejs` is not in the map, and
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
program. The scaffold's root `tsconfig.json` excludes `dashboard/`; the directory needs its own:

```json
{
  "extends": "ohnejs/tsconfig.browser.json",
  "compilerOptions": {
    "paths": { "app/*": ["./*", "../node_modules/ohnejs/src/layer/dashboard/*"] }
  },
  "include": ["**/*.ts", "../.ohne/shared/**/*.ts", "../.ohne/browser/**/*.ts"]
}
```

`ohnejs/tsconfig.browser.json` brings the DOM lib. `paths` resolves `app/` imports the way the server
does: your own directory first, then each stacked layer's dashboard directory - add one entry per
layer you list. The `../.ohne` globs bring the generated types - the typed `api` route ids and
message keys. The dashboard server warns at boot when the file is missing, printing this content
with the paths adjusted to your `dirs`.
