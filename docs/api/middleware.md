# Middleware

A middleware is a function that runs before the route handler, once per request. It receives the
request event - the same object `useEvent` returns - to authenticate, set headers, share data
with the handler, or answer the request outright.

```ts
// middleware/global/request-id.ts
import { defineMiddleware } from 'ohne';

export default defineMiddleware((event) => {
  event.response.headers.set('x-request-id', crypto.randomUUID());
});
```

The contract is small. Return nothing and the request continues to the next middleware, then the
handler. Return any value and it short-circuits: the value becomes the response, serialized
exactly like a handler's return, and the handler never runs. A thrown or returned `HTTPError`
maps to its status; see [errors](./errors.md).

Middleware lives in each layer's `dirs.middleware` directory - default `middleware/`, set in
[config](../project/config.md). Where a file sits decides when it runs: under `global/` it runs
on every request; anywhere else it is opt-in, run only by the routes that select it.

## Global middleware

A file under `middleware/global/` runs on every request, before any opt-in middleware. Globals
run in name order, so a numeric prefix orders them: `global/10-cors.ts` runs before
`global/20-auth.ts`.

A global that should only act on part of the app scopes itself with `matchPath`, which tests the
current request's path against one or more patterns:

```ts
// middleware/global/auth.ts
import { defineMiddleware, matchPath, unauthorized } from 'ohne';

export default defineMiddleware(async (event) => {
  if (!matchPath('/admin/**')) return;
  const session = await readSession(event.request);
  if (!session) return unauthorized();
  event.context.auth = session;
});
```

A pattern with a `[param]` matches like a route (`/authors/[id]`); anything else is a glob, `*`
matching one segment and `**` any depth. When you hold a path rather than a request,
`matchesPath(path, ...patterns)` is the same test.

`event.context` is the per-request bag a middleware fills and a handler reads - here, the
authenticated session. Augment the `EventContext` interface from a layer to type what you put
there.

## Route middleware

Every middleware outside `global/` is named and sits idle until a route opts in through
`defineHandler`'s `middleware` option:

```ts
// middleware/rate-limit.ts
import { defineMiddleware, tooManyRequests } from 'ohne';

export default defineMiddleware((event) => {
  if (overLimit(event.ip)) return tooManyRequests();
});
```

```ts
// api/search.get.ts
import { defineHandler } from 'ohne';

export default defineHandler(() => search(), { middleware: ['rate-limit'] });
```

The route runs every global middleware, then `rate-limit`, then the handler. An array lists the
named middleware to run, in that order; duplicates and unknown names are dropped. The globals
always run - the option adds on top of them, it cannot disable them.

The option also takes a function, handed every named middleware in the app, returning the subset
to run:

```ts
export default defineHandler(() => report(), {
  middleware: (available) => available.filter((name) => name !== 'rate-limit'),
});
```

The selection resolves once per route, not per request.

## Names and layers

The file's path under `middleware/` names it, kebab-case: `rate-limit.ts` is `rate-limit`,
`shop/audit.ts` is `shop-audit`, and the `global/` prefix is part of the name - `global/auth.ts`
is `global-auth`. A `_`-prefixed file or directory is a helper and is ignored. Two files in one
layer resolving to the same name is an error.

Layers merge by name: when two layers define the same name, the closer layer's file wins, so an
app replaces a layer's middleware by shadowing its path. The tier must match - a name cannot be
global in one layer and opt-in in another. See [layers](../project/layers.md).

## Per-request control

The `middleware:resolve` hook filters or reorders the resolved list - globals first, then the
route's selection - just before it runs. It is the escape hatch for dynamic, per-request
decisions; routine selection belongs on the route.

```ts
// boot/middleware.ts
import { hook, matchesPath } from 'ohne';

hook('middleware:resolve', (names, event) =>
  matchesPath(event.url.pathname, '/public/**')
    ? names.filter((name) => name !== 'global-auth')
    : names,
);
```

See [hooks](./hooks.md).

## CORS

Out of the box the API is open to browsers: every response carries
`Access-Control-Allow-Origin: *`, and a preflight allows any method and header. The wildcard is
credential-free - a browser never exposes a credentialed response under it - so cookies stay
safe even with the open default.

To restrict which origins may read responses, mount the `cors` middleware as a global:

```ts
// middleware/global/cors.ts
import { cors } from 'ohne';

export default cors({ origin: ['https://app.example.com'], credentials: true });
```

Mounting one replaces the open default. `origin` is a single origin, a list, or `'*'`; origins
match exactly - scheme, host, and port. There is no reflection mode: an origin you did not list
gets no CORS headers, and the browser blocks the read. Combining `origin: '*'` with
`credentials` throws - the browser forbids a credentialed wildcard.

The middleware answers a preflight `OPTIONS` itself with `204` and the allow headers; the server
answers `OPTIONS` on every route automatically and runs middleware first, so no `.options` route
is needed. The remaining options:

- `credentials` - send `Access-Control-Allow-Credentials`, so cookies and HTTP auth cross origins.
- `methods` - preflight allow-list; defaults to `GET`, `HEAD`, `PUT`, `PATCH`, `POST`, `DELETE`.
- `allowHeaders` - request headers to allow; omitted, the preflight reflects what was asked for.
- `exposeHeaders` - response headers scripts may read beyond the safelisted ones.
- `maxAge` - seconds the browser may cache the preflight; omitted, the browser uses its own default.

Globals run in name order, so an auth middleware that rejects anonymous requests must sort after
cors - a preflight carries no credentials, and rejecting it blocks the real request behind it.
Name the files to order them.

CORS governs what a browser will read, never who may call the API - authorization is its own
layer. For the full production posture, see [deployment](../production/deployment.md).
