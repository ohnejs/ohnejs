# Hooks

A hook is a named event the framework fires at a seam of its lifecycle - the server coming up, a
response about to leave for the socket. You register a callback for the name, and the framework
calls it when the moment comes. Where [middleware](./middleware.md) runs inside each request's
pipeline and can answer it, a hook is process-wide: registered once, it fires at every occurrence
of its event, request or not.

```ts
// boot/ready.ts
import { hook } from 'ohne';

hook('server:ready', async ({ host, port }) => {
  await warmCache();
  console.log(`accepting connections at http://${host}:${port}`);
});
```

## Registering

`hook(name, fn)` appends the callback to the hook's chain, and checks its signature against the
hook's declared type - an unknown name or a wrong parameter is a compile error. Register from a
[boot file](../project/boot.md): boot runs before the port opens, so the callback is in place for
the first occurrence.

When a hook fires, its callbacks run in registration order, each awaited before the next, so a mix
of sync and async callbacks stays deterministic. Across [layers](../project/layers.md), the
furthest layer boots first - a base layer's callbacks run ahead of yours.

## Actions and filters

A hook whose callbacks return nothing is an action, run for effect - `server:ready` is one. A hook
whose callbacks return a value is a filter: the first argument is a threaded value, and each
callback's return replaces it for the next. Returning `undefined` means "no change", so a callback
can act on the cases it cares about and stay silent otherwise - which also means a filter cannot
thread `undefined` as a value.

When the threaded value is a mutable object, the common shape is to change it in place and return
nothing:

```ts
// boot/headers.ts
import { hook } from 'ohne';

hook('response:headers', (headers) => {
  headers.set('X-Frame-Options', 'DENY');
});
```

## Built-in hooks

`server:ready({ host, port })` runs once the API server is listening, before readiness is
announced. Read `port` to learn the real port when `api.port` is `0`. Warm a cache, open a pool,
announce the address to discovery - an action, and a throw aborts startup. For teardown, register
`onShutdown` instead.

`middleware:resolve(names, event)` filters or reorders the middleware for a request, after the
globals and the route's selection resolve - globals first, then the route's list. Return the names
to run. It is an escape hatch for dynamic, per-request control; routine selection belongs
[on the route](./middleware.md). The list is a per-request copy, so leaving it untouched is safe.

`error:response(response, error, event)` filters the response built when a request throws - a
mapped [`HTTPError`](./errors.md) or an unhandled error's generic `500`. It runs inside the
request context, receives the thrown `error`, and a returned `Response` replaces the outcome: a
branded error page, a body with the detail redacted.

`response:send(response, event)` filters the finished response of a dispatched request, whatever
produced it - a handler result, a middleware answer, an error response after `error:response`, the
timed-out `503`. It runs outside the request context, so read the passed `event`, not the
composables. A router miss (`404`/`405`) never enters dispatch and skips it.

`response:headers(headers, response)` is the last seam before headers are written to the socket,
and the one that covers every response - including those that never enter dispatch, like a router
`404`/`405`. Stamp or strip headers in place, or return a replacement `Headers`; the read-only
`response` is there for status context.

## Declaring your own

A layer declares a hook by augmenting the `Hooks` interface - name it `group:name` in kebab-case,
type it as its callback signature. The declaration types both ends: `hook` checks callbacks
against it, and firing it takes the declared parameters.

```ts
// boot/hooks.ts
import { hook } from 'ohne';

declare module 'ohne' {
  interface Hooks {
    'report:filename': (name: string, date: Date) => string;
  }
}

hook('report:filename', (name, date) => `${date.toISOString().slice(0, 10)}-${name}`);
```

`applyHook` fires it: every registered callback runs in order, the first argument threads through
their returns, and the final value comes back. An action is fired the same way, just without using
the result.

```ts
import { applyHook } from 'ohne';

const name = await applyHook('report:filename', 'report.csv', new Date());
// -> '2026-07-16-report.csv'
```

With no callbacks registered, `applyHook` returns the first argument unchanged - firing a hook
nobody listens to costs nothing and breaks nothing.
