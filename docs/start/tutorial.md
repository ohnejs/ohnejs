# Your first app

This guide builds a small blog from an empty directory: a collection for posts, two API
endpoints, and a dashboard page that lists them. Along the way you meet each part of an ohne app
once: the database, the API, and the dashboard, each in its smallest working form.

## Scaffold

Create a project named `blog` and start the dev server. [Getting started](./installation.md)
covers what this sets up.

```sh
npm create ohne blog
cd blog
npm run dev
```

Leave `dev` running. It serves the dashboard at `http://localhost:9000` and the API at
`http://localhost:9001`, and regenerates types every time you save.

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

Save it. The API reloads, and the `Posts` table now exists in `.data/ohne.db`, a
[SQLite file](../database/engine.md#where-the-database-lives) ohne creates for you. There are no
migrations to write - [schema sync](../database/sync.md#what-happens-at-boot) explains how.

Both fields are required. A field needs a value unless you pass
[`nullable: true`](../database/collections.md#column-fields) or give it a
[`default`](../database/writing.md#defaults). A `text` field rejects the empty string unless you
pass `allowEmpty: true`. [Collections](../database/collections.md) covers every field type and
option.

## The first endpoint

Routes are files too. A file's path under `api/` is its URL, and a `.get` suffix sets the method:

```ts
// api/posts.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Posts').findMany());
```

`posts.get.ts` becomes `GET /posts`, live as soon as you save. The handler's return value is the
response, and [objects and arrays are sent as JSON](../api/routes.md#what-a-return-becomes).
[Routes](../api/routes.md#files-and-urls) covers the naming rules.

`query('Posts')` is fully typed. [Codegen](../project/cli.md#ohne-prepare) turned your collection
into types when you saved, so field names and results are checked as you type.
[Reading records](../database/queries.md) covers the query builder.

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

[`readJSONBody`](../api/request.md#the-body) reads the body and
[`setResponseStatus`](../api/response.md#status-and-headers) sets the status.

`create` never throws for bad input. It returns a [result](../database/writing.md#the-result) you
check:

- `ok: true` - `record` is the new post.
- `ok: false` - `errors` maps each failing field to a message.

You don't validate the body yourself. A missing field, a wrong value, or an unknown key comes back
in `errors`, never as a crash.

```sh
curl -X POST http://localhost:9001/posts \
  -H 'content-type: application/json' \
  -d '{"title": "Hello", "body": "First post."}'
```

The answer is `201` with the new post: your fields, plus the generated `UUID` and `_updatedAt`.
If you leave `body` out, the same call answers `422`:

```json
{ "errors": { "body": "validation.required" } }
```

Each value is a key from the framework's
[message catalogs](../i18n/messages.md#validation-messages), so a client can show it in the user's
language.

To skip the error handling, use `createOrThrow`. It returns the record and throws on bad input, and
the framework answers the `422` for you. [Writing records](../database/writing.md) covers the
details, and [errors](../api/errors.md#write-failures) covers the response shape.

Run the first `curl` again and your post is in the list.

## A dashboard page

Open `http://localhost:9000`. No user exists yet, so the dashboard asks you to create one. Enter
your name, email, and password, and choose **Create account**. You land on the overview, signed in
as [`admin`](../auth/roles.md#assigning-roles).

The dashboard is a browser app ohne serves straight from your `.ts` files, with no build step.
Pages follow the same file convention as routes, under
[`dashboard/pages/`](../dashboard/pages.md#from-file-to-route). Add one for your posts:

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

`posts.ts` is the dashboard's `/posts`. `shell` is the frame the built-in pages use: the header, the
sidebar, and a redirect to the login page when nobody is signed in. It comes from the `ohnejs/base`
layer, and you reach it through the [`app/` import](../dashboard/pages.md#what-a-page-may-import).

[`api`](../dashboard/data.md#fetching-from-the-api) is a typed `fetch` against the API. It
[autocompletes your routes](../dashboard/data.md#typed-route-ids), like `'GET /posts'`, and returns
the raw `Response`.

[`ref`](../dashboard/reactivity.md#ref) holds reactive state,
[`h`](../dashboard/rendering.md#elements) builds real DOM, and
[`each`](../dashboard/rendering.md#lists) renders a keyed list. Function children
like `() => post().title` are reactive: when `posts.value` changes, only the changed nodes update.

The page works by URL right away, but the sidebar lists only what the config names. Add a row in
`ohne.config.ts`:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
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

A declared `menu` replaces the default one:

- The first row brings back the overview, labeled with the layer's own message key.
- The second row is yours. `to` is the page's path, `label` shows as written, and `icon` names a
  [Tabler icon](https://tabler.io/icons).

Collections you leave out of the menu still appear, in their own group at the end. Here, that is
`Sessions` and `Users`. [The sidebar](../dashboard/pages.md#the-sidebar) covers groups, headings,
and translated labels.

One last file. Browser code type-checks against DOM types, not Node's, so the root `tsconfig.json`
excludes `dashboard/`. Give the dashboard its own
[`dashboard/tsconfig.json`](../dashboard/pages.md#type-checking):

```json
{
  "extends": "../.ohne/browser/tsconfig.json"
}
```

Codegen keeps the file it extends up to date: the DOM lib, `app/` imports, and the generated types.
To check it with your Node code, set the `typecheck` script in `package.json` to
`tsc && tsc -p dashboard/tsconfig.json`.

Pick **Posts** in the sidebar, or open `http://localhost:9000/posts`, and your posts are on screen.
From here, every dashboard save reloads the browser, and nothing restarts.

To go deeper into the dashboard:

- [Pages](../dashboard/pages.md) - the page convention and how pages are served.
- [Rendering](../dashboard/rendering.md) - `h`, `each`, and the router.
- [Reactivity](../dashboard/reactivity.md) - `ref` and `computed`.
- [Data](../dashboard/data.md) - the `api` helper.
