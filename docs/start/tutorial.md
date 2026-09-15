# Your first app

This guide builds a small blog from an empty directory: a collection for posts, two API
endpoints, and a dashboard page that lists them. Along the way you meet each part of an ohne app
once - the database, the API, the dashboard - in its smallest working form.

You need Node 26 or newer; [installation](./installation.md) covers the setup in detail.

## Scaffold

`npm create ohne` scaffolds a project:

```sh
npm create ohne blog
```

Answer the prompts - name, package manager, git - and it writes these files, installs the
dependencies, and prints the next steps:

- `ohne.config.ts` - the project's config, and what marks the directory as an ohne project
- `package.json` - scripts for `dev`, `serve:api`, `serve:dashboard`, `prepare`, and `typecheck`
- `tsconfig.json` - type-checks your Node code
- `.gitignore` - ignores generated files, the local database, and `.env`

The config is one declaration:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs'],
});
```

`layers` lists what the app is built on - here just the framework itself. Everything else is
convention: directories like `collections/` and `api/` that you add as you need them.
[Config](../project/config.md) and [layers](../project/layers.md) go deeper.

Start the dev server:

```sh
cd blog
npm run dev
```

`ohne dev` watches the project, regenerates types on every save, and starts two servers: the
dashboard at `http://localhost:9000` and the API at `http://localhost:9001`. Leave it running -
everything from here on happens while it watches.

## The collection

A collection is one file under `collections/`, named after it:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    body: field('text'),
  },
});
```

Save it and watch the terminal: dev reloads the API, and the boot syncs the schema. The `Posts`
table now exists - your two columns, plus a `UUID` primary key and an internal `_updatedAt`
timestamp that every collection gets. No migration files, no SQL;
[schema sync](../database/sync.md) covers how far that goes.

The database itself is a SQLite file at `.data/ohne.db`, created on demand - nothing to install,
nothing to configure. [The engine](../database/engine.md) covers connections and how to point at
a different database.

Both fields are required: a field is `NOT NULL` unless you pass `nullable: true`, and a `text`
field rejects the empty string by default. The full field surface - relations, composites,
uniques - lives in [collections](../database/collections.md).

## The first endpoint

Routes are files too. A file under `api/` names its path, and a `.get` suffix binds the method:

```ts
// api/posts.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Posts').findMany());
```

`posts.get.ts` becomes `GET /posts`. The handler returns whatever the response should be - here a
promise of records, and objects and arrays serialize as JSON. Save the file and the route is
live; [routes](../api/routes.md) has the naming rules, including `[param]` segments.

`query('Posts')` is fully typed. Codegen turned your collection file into types while you saved,
so field names, operators, and the returned rows all check at compile time -
[reading records](../database/queries.md) tours the builder.

Try it:

```sh
curl http://localhost:9001/posts
```

```json
[]
```

## Creating posts

The POST route reads a JSON body and writes:

```ts
// api/posts.post.ts
import { defineHandler, query, readJSONBody, setResponseStatus } from 'ohnejs';

export default defineHandler(async () => {
  const input = await readJSONBody<{ title: string; body: string }>();
  const result = await query('Posts').create(input);

  if (!result.ok) {
    setResponseStatus(422);
    return { errors: result.errors };
  }

  setResponseStatus(201);
  return result.record;
});
```

`readJSONBody` and `setResponseStatus` are the request and response surface in miniature - see
[reading the request](../api/request.md) and [shaping the response](../api/response.md) for the
rest.

`create` never throws for bad input. It returns a result you check: on success `record` is the
new post, read back in full; on failure `errors` maps each failing field to a message. The body
from `readJSONBody` is typed but unverified, and that is fine - `create` validates everything. A
missing field, a wrong value, even an unknown key comes back as a field error, never a crash.

```sh
curl -X POST http://localhost:9001/posts \
  -H 'content-type: application/json' \
  -d '{"title": "Hello", "body": "First post."}'
```

The answer is `201` with the created post: your fields, the generated `UUID`, and the
`_updatedAt` timestamp. Leave `body` out of the payload and the same call answers `422`:

```json
{ "errors": { "body": "validation.required" } }
```

Each entry names the failing field; the value is a key from the framework's
[message catalogs](../i18n/messages.md), so a client can render it in the user's language. When
you would rather not shape the failure yourself, `createOrThrow` returns the record directly and
throws on bad input - the framework then answers the `422` for you, translated messages included.
[Writing records](../database/writing.md) covers the whole pipeline, and
[errors](../api/errors.md) the wire shape.

Run the first `curl` again and your post is in the list.

## A dashboard page

The dashboard is a browser app ohne serves for you - no build step, no bundler. Your `.ts` files
are type-stripped and served as modules, straight from disk. Open `http://localhost:9000` now and
the ohne layer's own pages answer: with no user yet, it opens the first-user setup. Enter an email
and a password, choose **Create account**, and you land on the overview, signed in as `admin`.

Pages follow the same file convention as routes, under `dashboard/pages/`. Add one for your posts
beside the layer's own pages:

```ts
// dashboard/pages/posts.ts
import { api, defineDashboardPage, each, h } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

import { shell } from 'app/components/shell.ts';

interface Post {
  UUID: string;
  title: string;
  body: string;
}

export default defineDashboardPage(() =>
  shell(() => {
    const posts = ref<Post[]>([]);

    void api('GET /posts')
      .then((response) => response.json())
      .then((list: Post[]) => (posts.value = list));

    return h(
      'div',
      null,
      h('h1', null, 'Posts'),
      each(
        () => posts.value,
        (post) => post.UUID,
        (post) =>
          h('article', null, h('h2', null, () => post().title), h('p', null, () => post().body)),
      ),
    );
  }),
);
```

`posts.ts` is the dashboard's `/posts`. `shell` is the frame the layer's own pages render in: the
header, the sidebar, and a redirect to the login page when nobody is signed in. It lives in the
ohne layer's dashboard directory, and `app/` reaches it there - see
[what a page may import](../dashboard/pages.md#what-a-page-may-import).

The page fetches through `api`, a typed `fetch` against the API server: dev wires the two together,
and codegen suggests `'GET /posts'` because that route exists. It returns the raw `Response` - you
decide how to read it.

`ref` holds reactive state, `h` builds real DOM, and `each` renders a keyed list. The function
children - `() => post().title` - are reactive: when the fetch lands and `posts.value` changes,
the list fills in by patching exactly the nodes that changed. No virtual DOM, no re-render.

The page is reachable by URL as soon as the file exists, but the sidebar lists only what the config
names. Give it a row below the overview in `ohne.config.ts`:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs'],
  dashboard: {
    menu: [
      {
        items: [
          { to: '/overview', label: 'dashboard.overview.title', icon: 'layout-dashboard' },
          { to: '/posts', label: 'Posts', icon: 'article' },
        ],
      },
    ],
  },
});
```

A declared `menu` replaces the default one, so the first row brings the overview back, labeled
with the layer's own message key. The second row is yours: `to` is the page's path, a plain-string
`label` shows as written, and `icon` names a [Tabler icon](https://tabler.io/icons). Collections the
menu does not list, `Sessions` and `Users` here, still follow in a group of their own.
[The sidebar](../dashboard/pages.md#the-sidebar) covers groups, headings, and translated labels.

One last file. The root `tsconfig.json` excludes `dashboard/`, because browser code type-checks
against DOM types, not Node's. Give the dashboard its own `dashboard/tsconfig.json`:

```json
{
  "extends": "ohnejs/tsconfig.browser.json",
  "compilerOptions": {
    "paths": { "app/*": ["./*", "../node_modules/ohnejs/src/layer/dashboard/*"] }
  },
  "include": ["**/*.ts", "../.ohne/shared/**/*.ts", "../.ohne/browser/**/*.ts"]
}
```

Pick **Posts** in the sidebar, or open `http://localhost:9000/posts`, and your posts are on screen
inside the dashboard. From here, edits are instant: the
browser reloads on every dashboard save, and nothing restarts - pages are read fresh per request.
[Pages](../dashboard/pages.md) covers the convention and serving,
[rendering](../dashboard/rendering.md) the `h`, `each`, and router surface,
[reactivity](../dashboard/reactivity.md) the `ref` and `computed` primitives, and
[data](../dashboard/data.md) the `api` helper.
