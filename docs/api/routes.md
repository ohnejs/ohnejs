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
There is no router to configure and no table to register - the files are the routing.
[`ohne dev`](../project/cli.md#ohne-dev) picks up a new file as you save it.

The handler receives `{ params }`, may be sync or async, and its result type is inferred from what
you return. Inside it:

- [Composables](./request.md) read the rest of the request: the body, search params, cookies,
  headers, and the negotiated language.
- [Response composables](./response.md) set the status and headers, redirect, and stream.
- Failures are thrown: `notFound()`, `badRequest()`, and the other
  [named constructors](./errors.md#named-constructors) make an `HTTPError` that maps to its status.

## Files and URLs

Routes live in each layer's `dirs.api` directory, `api/` by default, set in
[config](../project/config.md#directories). The relative path becomes the URL:

- Directories are segments.
- The extension is stripped.
- A trailing `index` is dropped, so the file serves its directory's URL.

```
api/index.get.ts           GET /
api/authors.get.ts         GET /authors
api/authors.post.ts        POST /authors
api/authors/[id].get.ts    GET /authors/[id]
api/files/[...path].get.ts GET /files/[...path]
```

The method suffix sits before the extension: `.get`, `.post`, `.put`, `.patch`, `.delete`,
`.head`, or `.options`, case-insensitive. A file without one answers every method on its path.

[`api.basePath`](../project/config.md#the-api-server) puts the whole route table under one prefix:

- `'/api'` serves every route at `/api/...`.
- A request outside the prefix is a `404`.
- Handlers still see the path without the prefix.

These rules prevent confusion in the table:

- `api/authors.get.ts` and `api/authors/index.get.ts` name the same route, so defining both in one
  layer is an error. One would hide the other without a warning.
- Every `.ts` file in the directory is a route. There is no `_` convention for helper files here,
  because an underscore can start a real URL segment. So shared code lives outside the directory.

## Route params

A `[name]` segment, in a file or a directory name, matches exactly one URL segment, and its value is
set on `params` under that name. A `[...name]` catch-all matches one or more segments, slashes
included:

```ts
// api/files/[...path].get.ts
import { defineHandler } from 'ohnejs';

export default defineHandler(({ params }) => params.path);
```

`GET /files/img/logo.svg` sets `params.path` to `'img/logo.svg'`. A catch-all needs at least one
segment, so `/files` alone does not match.

Params are always strings, URI-decoded before they reach the handler. Directories can be params
too: the framework's own [messages endpoint](../i18n/messages.md#the-catalog-endpoint) lives at
`messages/[group]/[language].get.ts` and serves `GET /messages/[group]/[language]`.

## What a return becomes

The return value decides the response:

- An object, an array, or any other plain value is serialized as JSON.
- A string is sent as `text/html`.
- `null` or `undefined` sends an empty body with `204`, unless you set another status.
- A `ReadableStream`, `Uint8Array`, `ArrayBuffer`, or `Blob` streams as `application/octet-stream`.
- A web `Response` is sent as it is: its status, body, and headers win, and headers you set during
  the request are merged in with lower priority.
- An `HTTPError`, returned or thrown, becomes its status and the [error shape](./errors.md).

A `content-type` you set yourself is never overridden, so setting the header first sends a string
as `text/plain` instead of `text/html`.

## Matching

Requests match the most specific pattern first, segment by segment: a static segment beats a
`[param]`, which beats a `[...catch-all]`. `/authors/new` wins over `/authors/[id]` no matter how
the files sort. A single trailing slash is allowed, so `/authors/42/` matches `/authors/[id]`.

Escaped letters, digits and `-._~` are decoded before matching, so `/%70osts` is `/posts`. A path
with an encoded slash (`%2F`) gets a `404`, so a param never holds a `/` that was not a segment
boundary. To pass a value that contains `/`, use a `[...catch-all]` or a query param.

Methods you did not define yourself are filled in:

- On the same path, a method-suffixed file wins its method, and a suffixless file answers the rest.
- `HEAD` with no `HEAD` route is served by the path's `GET` route, and the body is not sent.
- `OPTIONS` with no `OPTIONS` route answers `204` with an `Allow` header listing what the path
  serves. Middleware runs first, so a [CORS middleware](./middleware.md#cors) can answer the
  preflight.

A path no route matches is a `404`. A path that matches, but not for the method, is a `405` with
the `Allow` header.

## Per-route options

`defineHandler` takes options as a second argument:

```ts
// api/reports.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Reports').findMany(), {
  handlerTimeout: '5m',
  rateLimit: { limit: 10, window: '1m' },
  middleware: ['audit-log'],
});
```

- `maxBodySize`, `handlerTimeout`, and `waitUntilTimeout` override their server-wide
  [`api.*` config](../project/config.md#the-api-server) for this one route. Each takes the same
  values as its config option: a number, a string like `'100mb'` or `'30s'`, or `false` to remove
  the limit.
- `rateLimit` caps how often one client may call the route. [Rate limiting](./rate-limiting.md)
  covers it.
- `middleware` turns on [named middleware](./middleware.md#route-middleware) for the route. They run
  after the global ones, which always run.

## Routes across layers

Every layer adds routes from its own `dirs.api`, and the tables merge by route id. A route id is the
method plus the pattern, like `GET /authors/[id]`. When two layers define the same id,
[the closer layer wins](../project/layers.md#what-overrides-what), so your app's file overrides the
one a layer ships.

To drop a layer's route instead of replacing it,
[disable it by glob](../project/config.md#disabling). A glob without a method prefix drops the
pattern for every method:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  disable: {
    routes: ['/internal/**', 'GET /admin/**'],
  },
});
```
