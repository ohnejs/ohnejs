# Middleware

A middleware is a function that runs before the route handler, once per request. It receives the
request event, the same object [`useEvent`](./request.md#the-event) returns. With it, a middleware
can [authenticate](../auth/authentication.md#protecting-routes-with-middleware), set headers, share
data with the handler, or answer the request instead of the handler.

```ts
// middleware/global/request-id.ts
import { defineMiddleware } from 'ohnejs';

export default defineMiddleware((event) => {
  event.response.headers.set('x-request-id', crypto.randomUUID());
});
```

The rules are simple:

- Return nothing, and the request continues to the next middleware, then the handler.
- Return any value, and it becomes the response, serialized exactly like a handler's return. The
  handler never runs.

Throw or return an [`HTTPError`](./errors.md), and the response uses its status.

## Global middleware

Middleware lives in each layer's [`dirs.middleware`](../project/config.md#directories) directory,
`middleware/` by default. Where a file sits decides when it runs:

- Under `global/`, it runs on every request, before any opt-in middleware.
- Anywhere else, it is opt-in, so it runs only on the [routes that select it](#route-middleware).

Globals from every layer run together in name order, so a numeric prefix orders them:
`global/10-request-id.ts` runs before `global/20-locale.ts`. A digit sorts before any letter, so
prefixed globals run before unprefixed ones.

A global that should only act on part of the app limits itself with `matchPath`, which tests the
current request's path against one or more patterns:

```ts
// middleware/global/session.ts
import { defineMiddleware, matchPath, unauthorized } from 'ohnejs';

export default defineMiddleware(async (event) => {
  if (!matchPath('/admin/**')) return;
  const session = await readSession(event.request);
  if (!session) return unauthorized();
  event.context.auth = session;
});
```

- A pattern with a `[param]` matches like a [route](./routes.md#route-params): `/authors/[id]`.
- Anything else is a glob: `*` matches one segment, and `**` any depth.
- `matchesPath(path, ...patterns)` is the same test, for when you have a path instead of a request.

The example stores the session on `event.context`, the per-request object that a middleware fills
and a handler reads. [The event](./request.md#the-event) shows how to type it by augmenting
`EventContext`.

## Route middleware

Every middleware outside `global/` has a name and does nothing until a route selects it through
`defineHandler`'s [`middleware` option](./routes.md#per-route-options):

```ts
// middleware/rate-limit.ts
import { defineMiddleware, tooManyRequests } from 'ohnejs';

export default defineMiddleware((event) => {
  if (overLimit(event.ip)) return tooManyRequests();
});
```

```ts
// api/search.get.ts
import { defineHandler } from 'ohnejs';

export default defineHandler(() => search(), { middleware: ['rate-limit'] });
```

The route runs every global middleware, then `rate-limit`, then the handler.

- An array lists the named middleware to run, in that order. Duplicates and unknown names are
  dropped.
- The globals always run. The option adds on top of them and cannot disable them.

The option also takes a function. It receives every named middleware in the app and returns the
ones to run:

```ts
export default defineHandler(() => report(), {
  middleware: (available) => available.filter((name) => name !== 'rate-limit'),
});
```

The selection is computed once per route, not on every request.

## Names and layers

The file's path under `middleware/` names it, in kebab-case:

- `rate-limit.ts` is `rate-limit`.
- `shop/audit.ts` is `shop-audit`.
- `global/auth.ts` is `global-auth`, since the `global/` prefix is part of the name.

A `_`-prefixed file or directory is a helper and is ignored. It is an error when two files in one
layer resolve to the same name.

[Layers merge by name](../project/layers.md#what-overrides-what): when two layers define the same
name, the closer layer's file wins. So an app replaces a layer's middleware by shadowing it with a
file at the same path. The tier must match, so a name cannot be global in one layer and opt-in in
another.

## Per-request control

The [`middleware:resolve`](./hooks.md#middlewareresolve) hook filters or reorders the resolved list
just before it runs. The list has the globals first, then the route's selection. Use the hook only
for dynamic, per-request decisions. Normal selection belongs on the route.

```ts
// boot/middleware.ts
import { hook, matchesPath } from 'ohnejs';

hook('middleware:resolve', (names, event) =>
  matchesPath(event.url.pathname, '/public/**')
    ? names.filter((name) => name !== 'global-session')
    : names,
);
```

## CORS

The `ohnejs/base` layer ships `middleware/global/cors.ts`. The dashboard's origin may make requests
with credentials, and every other origin gets no CORS headers. The dashboard's origin is the first
of these that is set:

1. The [`DASHBOARD_URL`](../project/env.md#the-built-ins) env var.
2. [`dashboard.origin`](../project/config.md#the-dashboard) in config.
3. `http://localhost` on `dashboard.port`.

Without the `ohnejs/base` layer, every response carries `Access-Control-Allow-Origin: *` without
credentials, so cookies stay safe.

To pick the origins yourself, shadow that file and keep the dashboard's origin in the list, here
`https://admin.example.com`:

```ts
// middleware/global/cors.ts
import { cors } from 'ohnejs';

export default cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
});
```

Only a file that resolves to the same name, `global-cors`, shadows the shipped policy. Any other
name, such as `global/10-cors.ts`, adds a second global middleware, and both policies run.

Adding `cors()` replaces the open default. Its options:

- `origin` - a single origin, a list, or `'*'`. Origins match exactly: scheme, host, and port.
  There is no reflection mode, so an origin you did not list gets no CORS headers, and the browser
  blocks the read.
- `credentials` - send `Access-Control-Allow-Credentials`, so cookies and HTTP auth work across
  origins. Combining it with `origin: '*'` throws, since the browser does not allow credentials with
  a wildcard.
- `methods` - preflight allow-list. Defaults to `GET`, `HEAD`, `PUT`, `PATCH`, `POST`, `DELETE`.
- `allowHeaders` - request headers to allow. When omitted, the preflight allows the headers the
  browser asked for.
- `exposeHeaders` - response headers that scripts may read, in addition to the safelisted ones.
- `maxAge` - seconds the browser may cache the preflight. When omitted, the browser uses its own
  default.

It answers a preflight [`OPTIONS`](./routes.md#matching) itself, with `204` and the allow headers,
so you need no `.options` route.

An auth middleware that rejects anonymous requests must sort after `cors`. A preflight carries no
credentials, and rejecting it blocks the real request that follows it. Globals from every layer
share one name order: `global/session.ts` above runs after `cors`, while `global/auth.ts` and
`global/20-auth.ts` run before it.

CORS controls what a browser will read, never who may call the API.
[Authorization](../auth/roles.md#guarding-your-own-routes) is handled separately, and
[deployment](../production/deployment.md#cors) covers the production setup.
