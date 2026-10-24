# Dashboard pages

The dashboard is your app's browser UI, served by ohne itself. There is no build step. Your `.ts`
files go to the browser as JavaScript with the types removed, which is also how Node runs
TypeScript. You write a page, save, and the browser reloads.

A page is one file under `dashboard/pages/`, exporting a component:

```ts
// dashboard/pages/index.ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage(() => h('h1', null, 'Hello'));
```

[`npx ohne dev`](../project/cli.md#ohne-dev) serves it at `http://localhost:9000`, alongside the
API. With `ohnejs/base` in your layers, it renders inside the dashboard's [frame](#the-frame): the
header, the sidebar, and the sign-in redirect.

## From file to route

The file's path under `pages/` is the route. An `index` at the end is dropped, `[name]` declares a
param, and `[...name]` a catch-all:

- `pages/index.ts` becomes `/`
- `pages/authors.ts` becomes `/authors`
- `pages/authors/[id].ts` becomes `/authors/[id]`
- `pages/files/[...path].ts` becomes `/files/[...path]`

When several routes match a URL, the most specific one wins.

- Every `.ts` file under `pages/` is a page. A `_` prefix does not mark a helper file here, so
  shared components live [elsewhere in the dashboard directory](#what-a-page-may-import).
- Two files in one layer that resolve to the same route are an error, since one would replace the
  other without a warning.
- Between layers, [the closer layer's page wins](../project/layers.md#what-overrides-what).

## The page component

`defineDashboardPage` types your page function. The function receives the route context:

- `params` - the matched route's params, already URI-decoded.
- `path` - the matched location path.
- `query` - the search params, decoded to strings, numbers, booleans, arrays, and objects.

```ts
// dashboard/pages/authors/[id].ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage((route) => h('h1', null, `Author ${route.params.id}`));
```

The runtime defines what the component returns and how it updates:

- [`h`](./rendering.md#elements), [`each`](./rendering.md#lists), and
  [`when`](./rendering.md#conditionals) build the view.
- [`ref`](./reactivity.md#ref) holds state.
- [`useResource`](./data.md) loads data from your API.

The page component runs once per visit:

- It runs again when the path changes.
- A navigation that changes only the query keeps the page. `route.query` updates in place.
- A ref it read, or a [dashboard language](./data.md#switching-the-language) switch, never reruns it.

Bind a live value, and every `t` call, with a [function child](./rendering.md#children) instead.

## The page title

Every page starts with the bare `ohne` title. To name it, call `useDocumentTitle` in the page:

```ts
// dashboard/pages/posts.ts
import { defineDashboardPage, h, useDocumentTitle } from 'ohnejs/dashboard';

export default defineDashboardPage(() => {
  useDocumentTitle('Posts');
  return h('h1', null, 'Posts');
});
```

The tab now reads `Posts - ohne`.

- A [message key](../i18n/messages.md#catalogs) translates, and follows a language switch.
- A function follows its data, with no `effect`: `useDocumentTitle(() => post.value?.title)`.
- The title lasts while the page or component that set it lives. The newest live one wins.
- The kit's [`page`](./layout.md#page) sets it from its own `title`.

## The frame

The frame is the chrome around every page: with `ohnejs/base`, the header, the sidebar, and the
redirect to the login page while nobody is signed in. It mounts once and stays across navigations,
so your page holds only content.

A sign-in or redirect-only page opts out:

```ts
// dashboard/pages/welcome.ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage(() => h('h1', null, 'Welcome'), { frame: false });
```

A page asks the frame for more room with `useFrame`, while it lives:

- `useFrame({ fill: true })` hands it the main area edge to edge at full height. The page scrolls
  itself.
- `useFrame({ wide: true })` gives it the full window width. The sidebar becomes an overlay.

To replace the frame, add a `dashboard/boot/shell.ts` that calls `registerPageFrame`. It
[replaces](#boot-files) the base layer's file of that name. The frame receives `content`, the page
as a function child, and `options()`, what the live `useFrame` calls ask for:

```ts
// dashboard/boot/shell.ts
import { h, registerPageFrame } from 'ohnejs/dashboard';

registerPageFrame(({ content, options }) =>
  h('main', { class: () => (options().fill ? 'fill' : 'padded') }, content),
);
```

## State in the URL

`useSearchParam` binds one query param to a ref, so a view survives a reload and a shared link:

```ts
const view = useSearchParam('view', { fallback: 'grid', choices: ['grid', 'list'] });

view.value = 'list'; // -> the URL gains `?view=list`, the page stays
```

- `fallback` types the ref. It is the value while the param is absent or does not fit, and writing
  it removes the param.
- `choices` narrows the type to its members. Any other value reads as the fallback.
- A write replaces the history entry. Pass `history: 'push'` so back undoes it.

Read the URL through `route.query` or `useSearchParam`, never `location.search`. Only those follow a
navigation that keeps the page.

## Navigation

The dashboard is a single-page app. The server answers every path with the same shell, so a link to
any page loads directly. From there the router renders the page matching the URL and swaps pages in
place, without a full reload. These navigate:

- A left-click on a same-origin link, so `h('a', { href: '/posts' }, 'Posts')` works with no extra
  code.
- `navigate(path)`, to navigate from code. It does nothing when you are already there.
- The back and forward buttons.

```ts
import { h, navigate } from 'ohnejs/dashboard';

h('button', { onClick: () => navigate('/posts') }, 'Open posts');
```

The router leaves some clicks to the browser: a click with a modifier key, another origin, a
`target`, a `download`, and an in-page `#` anchor on the same path.

The browser fetches a page's code the first time its route renders. A URL that no page matches
renders the dashboard's not-found page.

`lastNavigation()` tells a page how it was reached:

- `load` - the initial page load.
- `navigate` - a `navigate` call or a clicked link.
- `popstate` - the back or forward button.

Some pages remember a view and restore it whenever their query arrives bare. Such a page watches
`route.query` and checks `lastNavigation()` first, so going back still lands on the bare view:

```ts
effect(() => {
  if (isEmpty(route.query) && remembered !== '' && lastNavigation() !== 'popstate') {
    navigate(route.path + remembered, { replace: true });
  }
});
```

## Unsaved changes

`useUnsavedChanges` guards edits a page holds. While its getter reports dirty edits, leaving asks
first:

```ts
const draft = ref('');
useUnsavedChanges(() => draft.value !== '');
```

- A navigation that leaves the path waits on the leave prompt. With `ohnejs/base` that is the
  unsaved-changes dialog. A step that changes only the query never asks.
- Closing the tab raises the browser's own prompt.
- The guard lasts as long as the page, or the reactive scope that called it.
- A surface with its own edits, like a popup closing on Escape, asks through `confirmLeave()`.

## The sidebar

The sidebar starts with the overview page, then lists every collection the viewer can reach under
**Collections**. A page opens by URL as soon as its file exists. To give it a link, add a node to
[`dashboard.menu`](../project/config.md#the-dashboard):

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dashboard: {
    menu: {
      reports: { parent: 'general', to: '/reports', label: 'Reports', icon: 'chart-bar' },
    },
  },
});
```

The key, `reports`, is the node's id. The node says where it sits and what it shows:

- `parent` - the id of the node it sits under. Omit it to place the node at the root.
- `to` - the dashboard path it opens.
- `label` - its text: a [message key](../i18n/messages.md#catalogs), a `{ key, params }` object,
  or plain text.
- `icon` - a [Tabler icon](https://tabler.io/icons).
- `order` - its place among its siblings, lowest first. It defaults to `10`. Nodes with the same
  `order` keep the order you declare them in.

`ohnejs/base` declares the nodes you usually place yours under:

| Id            | What it is                                                               |
| ------------- | ------------------------------------------------------------------------ |
| `general`     | The first section, without a heading. It holds `overview`.               |
| `collections` | The **Collections** section, where every collection lands unless placed. |
| `management`  | The **Management** section. It holds `Users`.                            |
| `utilities`   | The **Utilities** section, shown once something sits in it.              |
| `overview`    | The link to the overview page.                                           |

The server refuses to start when a `parent` names no node, when a node ends up under itself, when a
link has no label, or when a node holds nothing at all. The last one is usually a misspelled id, so
the error suggests the name you meant.

### Groups and collections

A node without `to` is a group. At the root, a group is a section with its label as the heading.
Below the root, it is a row that expands to show what it holds. A group with nothing to show is
left out.

A collection is a node too, keyed by its name. Its label and
[icon](../database/collections.md#the-collection-in-the-dashboard) come from the collection, so
moving it takes only a `parent`:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dashboard: {
    menu: {
      shop: { order: 2, label: 'Shop' },
      Orders: { parent: 'shop' },
      Products: { parent: 'shop' },
      sales: { parent: 'shop', to: '/sales', label: 'Sales', icon: 'coin' },
    },
  },
});
```

A [singleton](../database/collections.md#singletons)'s link opens its record instead of a list.

### Changing what a layer declares

Every layer's menu merges node by node. To change a node, name its id and set only what should
differ. The rest stays as the layer declared it:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dashboard: {
    menu: {
      overview: { label: 'Home' },
      Users: { parent: 'collections' },
      management: { hidden: true },
    },
  },
});
```

- `hidden: true` hides a node and everything under it. A layer closer to your app can set
  `hidden: false` to bring it back.
- A collection the menu does not reach is left off the overview page too.
- `parent: null` moves a node to the root, even when a layer gave it a parent.
- A `to` or an `icon` a layer set cannot be removed. Hide the node and declare your own instead.

### Who sees what

A viewer sees a collection only when they can reach it. For any other node, `can` names the
[capability](../auth/roles.md#capabilities) a viewer needs to see it and everything under it:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  dashboard: {
    menu: {
      reports: { parent: 'general', to: '/reports', label: 'Reports', can: 'reports.read' },
    },
  },
});
```

The menu only hides links. Anyone can still open `/reports` by URL, so the routes the page calls
must check access themselves. For a rule `can` cannot express, filter the menu in the
[`dashboard:menu`](../project/hooks.md#dashboardmenu) hook.

## Boot files

A dashboard boot file is a `.ts` file at the top level of `dashboard/boot/`. It runs once: the
dashboard imports it when it loads, before the first page renders. Use it for registrations the
pages rely on, like a [field type](../database/custom-field-types.md#in-the-dashboard) or a piece of
UI mounted for the whole dashboard.

```ts
// dashboard/boot/rating.ts
import { registerFieldType } from 'ohnejs/dashboard';

declare module 'ohnejs/dashboard' {
  interface KnownFieldTypes {
    rating: { options: { max?: number }; value: number };
  }
}

registerFieldType('rating', {
  display: ({ value }) => () => '★'.repeat(Number(value() ?? 0)),
});
```

The `KnownFieldTypes` entry names the type's options and value, so
[`field('rating')`](./forms.md#typing-a-custom-field-type) type-checks in a page form.

Files run in the same order as [server boot files](../project/boot.md#ordering).

Across layers, the [furthest layer boots first](../project/layers.md#the-stack), so a base layer's
field types are already registered when your boot files run. A boot file's identity is its path:
your `boot/fields.ts` [replaces](../project/layers.md#what-overrides-what) a layer's
`boot/fields.ts` and runs in its place.

## What a page may import

The browser fetches modules by URL, so everything in the dashboard directory is public.

A page can import these names:

- `ohnejs/dashboard` - the browser runtime: `defineDashboardPage`, `h`, `api`, `useT`, ...
- `ohnejs/utils` - the utilities that run in both Node and the browser, the same module your Node
  code imports.
- `app/` - your dashboard directory, so `app/components/nav.ts` is `dashboard/components/nav.ts`.

Relative imports work too.

- Name the full file, extension included. The browser resolves URLs, not packages.
- An `app/` import and a relative import of the same file load one module, with one shared state.
- `app/` merges every layer's dashboard directory, closest layer first, so an app file replaces a
  layer's file at the same path.
- The same merge lets a layer import another layer's dashboard files by their `app/` path:
  `app/components/shell-slots.ts` resolves wherever in the stack the file lives. To make the editor
  resolve these imports too, see [type checking](#type-checking).

These names are the whole boundary between browser and server. The server serves only the dashboard
runtime and the utils, never the Node framework, so browser code cannot import server code.
`ohnejs` is not among them, and you cannot use `useDatabase` in a page. Data crosses over HTTP,
through [`api`](./data.md#calling-the-api-directly).

## Serving

[`ohne dev`](../project/cli.md#ohne-dev) serves the dashboard as a second process beside the API,
with live reload. Saving a dashboard file reloads the connected browsers and leaves the API
running, since nothing under the dashboard directory restarts it. In production,
[`ohne serve dashboard`](../project/cli.md#ohne-serve) serves the same thing without the reload
channel.

You set the port, the host, and the API base URL the browser talks to under
[`dashboard.*`](../project/config.md#the-dashboard) in config.

### Caching

The browser keeps each dashboard module until its content changes. A module's URL carries a
fingerprint of its bytes, so the browser caches it for good and never asks for it again. After a
deploy or an edit, it downloads only the files that changed.

Every reload revalidates the page itself, so a reload always picks up the new files. You configure
nothing. If a proxy or CDN sits in front of the dashboard, see
[dashboard caching](../production/deployment.md#dashboard-caching).

## Type checking

Dashboard code is browser code: it has DOM types and no `node:` imports. So it type-checks as its
own program. The [scaffold's root `tsconfig.json`](../start/installation.md#the-project-files)
excludes `dashboard/`, so the directory needs its own:

```jsonc
// dashboard/tsconfig.json
{
  "extends": "../.ohne/browser/tsconfig.json"
}
```

That is the whole file. [Codegen](../project/cli.md#ohne-prepare) writes the one it extends and
keeps it up to date:

- `ohnejs/tsconfig.browser.json` is at the top of the chain and adds the DOM lib.
- `paths` resolves `app/` imports the way the server does: your own directory first, then each
  stacked layer's dashboard directory. List a new layer, and the next `dev` boot or `prepare`
  adds its entry.
- `include` covers your dashboard directory and the generated types: the
  [typed `api` route ids](./data.md#typed-route-ids) and
  [message keys](../i18n/messages.md#typed-keys).

The file exists once `prepare` has run, which an install does for you. Your own file can add
`compilerOptions`; an `include` of your own would replace the generated one, so leave that to
codegen.

Plain `tsc` skips this program, so set the `typecheck` script in `package.json` to
`tsc && tsc -p dashboard/tsconfig.json`.

The dashboard server warns at boot when the file is missing. The warning prints the `extends` line
and the `typecheck` command, with paths adjusted to your `dirs`.
