# Routes

An API route is one file. Its path under `api/` is the URL, a suffix on the name picks the HTTP
method, and the default export handles the request:

```ts
// api/authors/[id].get.ts
import { defineHandler, notFound, query } from 'ohnejs';

export default defineHandler(async ({ params }) => {
  const author = await query('Authors').where('UUID', params.id).findFirst();
  if (!author) throw notFound();
  return author;
});
```

`GET /authors/42` runs the handler with `params.id` set to `'42'` and returns the author as JSON.
There is no router to configure and no table to register - the files are the routing. `ohne dev`
picks up a new file as you save it; see the [CLI](../project/cli.md).

## Files and URLs

Routes live in each layer's `dirs.api` directory - default `api/`, set in
[config](../project/config.md). The relative path becomes the URL: directories are segments, the
extension is stripped, and a trailing `index` collapses into its parent.

```
api/index.get.ts           GET /
api/authors.get.ts         GET /authors
api/authors.post.ts        POST /authors
api/authors/[id].get.ts    GET /authors/[id]
api/files/[...path].get.ts GET /files/[...path]
```

The method suffix sits before the extension: `.get`, `.post`, `.put`, `.patch`, `.delete`,
`.head`, or `.options`, case-insensitive. A file without one answers every method on its path.

`api/authors.get.ts` and `api/authors/index.get.ts` name the same route, so defining both in one
layer is an error - one would silently shadow the other.

Every `.ts` file in the directory is a route. Unlike `collections/`, there is no `_` helper
convention here - an underscore can start a real URL segment - so shared code lives outside the
directory.

## Route params

A `[name]` segment - in a file or a directory name - matches exactly one URL segment and lands on
`params` under its name. A `[...name]` catch-all matches one or more segments, slashes included:

```ts
// api/files/[...path].get.ts
import { defineHandler } from 'ohnejs';

export default defineHandler(({ params }) => params.path);
```

`GET /files/img/logo.svg` sets `params.path` to `'img/logo.svg'`. A catch-all needs at least one
segment, so `/files` alone does not match.

Params are always strings, URI-decoded before they reach the handler. Directories can be params
too: the framework's own messages endpoint lives at `messages/[group]/[language].get.ts` and
serves `GET /messages/[group]/[language]`.

## Inside a handler

`defineHandler` takes a function and returns it unchanged, typed: the handler receives
`{ params }`, may be sync or async, and its result type is inferred from what you return.

Everything else about the request - the body, search params, cookies, headers, the negotiated
language - is read through composables you call inside the handler; see
[reading the request](./request.md). Status, headers, redirects, and streaming are the response
side; see [shaping the response](./response.md).

Failures are thrown, not returned: `notFound()`, `badRequest()`, and the other builders make an
`HTTPError` that maps to its status on the wire. See [errors](./errors.md).

## What a return becomes

The return value decides the response:

- An object, an array - any plain value - serializes as JSON.
- A string is sent as `text/html`.
- `null` or `undefined` sends an empty body - `204`, unless you set another status.
- A `ReadableStream`, `Uint8Array`, `ArrayBuffer`, or `Blob` streams as `application/octet-stream`.
- A web `Response` passes through: its status, body, and headers win, and headers you set during
  the request merge in beneath them.
- An `HTTPError`, returned or thrown, becomes its status and the wire error shape; see
  [errors](./errors.md).

A `content-type` you set yourself is never overridden, so setting the header first sends a string
as `text/plain` instead of `text/html`.

## Matching

Requests match the most specific pattern first, segment by segment: a static segment beats a
`[param]`, which beats a `[...catch-all]`. `/authors/new` wins over `/authors/[id]` no matter how
the files sort. A single trailing slash is tolerated - `/authors/42/` matches `/authors/[id]`.

Methods fill in where you were not explicit:

- On the same path, a method-suffixed file wins its method; a suffixless file answers the rest.
- `HEAD` with no `HEAD` route is served by the path's `GET` route, the body dropped on the wire.
- `OPTIONS` with no `OPTIONS` route answers `204` with an `Allow` header listing what the path
  serves. Middleware runs first, so a [CORS middleware](./middleware.md) can answer the preflight.

A path no route matches is a `404`. A path that matches, but not for the method, is a `405` with
the `Allow` header.

## Per-route options

`defineHandler` takes options as a second argument:

```ts
// api/reports.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Reports').findMany(), {
  handlerTimeout: '5m',
  middleware: ['rate-limit'],
});
```

`maxBodySize`, `handlerTimeout`, and `waitUntilTimeout` override their server-wide `api.*` config
values for this one route. Each takes what its config sibling does - a number, a string like
`'100mb'` or `'30s'`, or `false` to lift the limit entirely. `middleware` opts the route into
named middleware, run after the always-on global ones; see [middleware](./middleware.md).

## Routes across layers

Every layer contributes routes from its own `dirs.api`, and the tables merge by route id - the
method plus the pattern, `GET /authors/[id]`. When two layers define the same id, the closer layer
wins: your app's file overrides the one a layer ships. To drop a layer's route instead of
replacing it, disable it by glob:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  disable: {
    routes: ['/internal/**', 'GET /admin/**'],
  },
});
```

A glob without a method prefix drops the pattern for every method. See
[layers](../project/layers.md) for how the stack resolves.

Finally, `api.basePath` mounts the whole table under one prefix: `'/api'` serves every route at
`/api/...`, a request outside the prefix is a `404`, and handlers still see the bare path. Set it
in [config](../project/config.md).
