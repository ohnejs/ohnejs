# Rate limiting

A rate limit caps how often one client may call a route. Reach for it on routes that cost you
something on every call, like a search, an email sent, or an expensive report, so one client cannot
flood them:

```ts
// api/reports.get.ts
import { defineHandler, query } from 'ohnejs';

export default defineHandler(() => query('Reports').findMany(), {
  rateLimit: { limit: 10, window: '1m' },
});
```

Each client may now call `GET /reports` ten times a minute. The eleventh call gets a `429`.

## The limit

`limit` is how many calls one client gets per `window`:

- A client may spend all ten at once. It then regains one call every six seconds (`window / limit`),
  without waiting for the whole window.
- `window` takes milliseconds, or a string like `'30s'`, `'1m'`, or `'1h'`.
- A refused call costs nothing, so a client that keeps retrying gets in as soon as a call is free.
- `HEAD` shares its `GET` route's limit.
- Omitted, the route is unlimited. There is no server-wide default.
- An invalid `limit` or `window` stops the server from starting, with the route's file named.

## The 429 response

A client past the limit gets a `429` [HTTP error](./errors.md) with a `Retry-After` header, the
whole seconds until it may call again:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 6
```

- The limit is checked after the [middleware](./middleware.md), before the body is read. A refused
  call never reaches your handler.
- A call that a middleware answers itself is not counted.

## Who counts as one client

A client is its IP address, [`event.ip`](./request.md#the-event):

- An IPv6 client counts per `/64` network. One device usually owns a whole `/64`, so it cannot
  dodge the limit by switching addresses.
- Behind a proxy, set [`api.trustProxy`](../production/deployment.md#behind-a-proxy), or every
  client shares the proxy's IP, and with it one limit.
- A request with no known IP is never limited.

## Limiting by hand

To count by something other than the IP, such as the signed-in user, create a limiter with
`createRateLimiter` and call `enforceRateLimit` in the handler:

```ts
// api/exports.get.ts
import { defineHandler, enforceRateLimit, query, useRateLimitStore } from 'ohnejs';
import { requireUser } from 'ohnejs/auth';
import { createRateLimiter } from 'ohnejs/utils';

const limiter = createRateLimiter({
  name: 'exports',
  limit: 5,
  window: '1h',
  store: useRateLimitStore(),
});

export default defineHandler(async () => {
  const user = await requireUser();
  await enforceRateLimit(limiter, user.UUID);
  return query('Reports').findMany();
});
```

- The key is any string, and one key shares one limit. Without a key, it counts the client's IP,
  like the route option does.
- `store: useRateLimitStore()` counts where route limits do, [across processes](#across-processes)
  too. Give each such limiter its own `name`, so two limiters never share a count.
- `await limiter.reset(key)` gives a key its full limit back.

## Sharing one limit

To give several routes one shared limit, call `enforceRateLimit` from a
[middleware](./middleware.md):

```ts
// middleware/api-quota.ts
import { defineMiddleware, enforceRateLimit, useRateLimitStore } from 'ohnejs';
import { createRateLimiter } from 'ohnejs/utils';

const limiter = createRateLimiter({
  name: 'api-quota',
  limit: 1000,
  window: '1h',
  store: useRateLimitStore(),
});

export default defineMiddleware(() => enforceRateLimit(limiter));
```

- Every route that selects `middleware: ['api-quota']` draws from the same thousand calls an hour.
- Put the file under `middleware/global/` instead, and every route shares it.

## Across processes

By default, each process counts in its own memory. Run four processes, such as a PM2 cluster, and
a client gets up to four times the limit. A restart or a deploy clears every count.

To count once for every process, keep the counts in a helper database:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  database: {
    helpers: { rateLimits: '.data/rate-limits.db' },
  },
  api: {
    rateLimitStore: 'database',
    rateLimitDatabase: 'rateLimits',
  },
});
```

- Every process that opens the file shares one count, and counts survive a restart.
- On SQLite, give the helper its own file. In the main file, counting would wait on your writes.
- While the database is too busy to count, a limited request answers `503` with `Retry-After`.

## Your own store

A store is an object with `take(key, rate)` and `reset(key)`. `take` resolves `0` to allow a hit,
or the milliseconds to wait. It must decide and count in one atomic step, or two processes can both
take the last free hit. Register it from a [boot file](../project/boot.md) and select it by name:

```ts
// boot/rate-limit.ts
import { useRateLimitStores } from 'ohnejs';

import { createRedisRateLimitStore } from '../lib/redis-rate-limit-store.ts';

useRateLimitStores().register('redis', createRedisRateLimitStore);
```

Then set `api.rateLimitStore: 'redis'`. An optional `check()` runs before the server listens, and
an optional `close()` runs after it drains.
