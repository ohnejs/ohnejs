# Shaping the response

A handler returns its value and ohne serializes it - an object becomes JSON, a string HTML, an
empty return `204`; [routes](./routes.md) has the full rules. Everything else about the response -
status, headers, redirects, caching, streams - is shaped by composables you call inside the
handler. They are ambient: valid anywhere within a request, at any call depth, no threading.

## Status and headers

Every request carries mutable response state the serializer reads once the handler returns.
`useResponse()` hands it to you - assign `status`, mutate `headers` in place:

```ts
// api/export.get.ts
import { defineHandler, useResponse } from 'ohne';

export default defineHandler(() => {
  useResponse().headers.set('cache-control', 'no-store');
  return { ok: true };
});
```

`setResponseStatus` is the shorthand for the common case:

```ts
// api/subscribers.post.ts
import { defineHandler, setResponseStatus } from 'ohne';

export default defineHandler(async () => {
  const subscriber = await subscribe();
  setResponseStatus(201);
  return subscriber;
});
```

You still return the body; these only shape the status and headers around it. `headers` is a
standard `Headers`, so `set`, `append`, and `delete` all work.

## Redirects

`sendRedirect` sets the status and the `Location` header together; the status defaults to `302`:

```ts
// api/old-posts.get.ts
import { defineHandler, sendRedirect } from 'ohne';

export default defineHandler(() => sendRedirect('/posts', 301));
```

It returns nothing, so the handler body is empty and serializes at the redirect status.

## Caching

The conditional-request pattern is three moves: put a validator on the response, ask whether the
client's cached copy is still fresh, answer `304` when it is. `etag` computes the validator,
`isFresh` compares, `sendNotModified` answers:

```ts
// api/posts.get.ts
import { defineHandler, isFresh, query, sendNotModified, useResponse } from 'ohne';
import { etag } from 'ohne/utils/etag';

export default defineHandler(async () => {
  const posts = await query('Posts').findMany();

  useResponse().headers.set('etag', etag(JSON.stringify(posts)));
  if (isFresh()) return sendNotModified();

  return posts;
});
```

`isFresh` compares the request's `If-None-Match` / `If-Modified-Since` against the `ETag` /
`Last-Modified` you set on the response, so set the validator first. The comparison is weak - a
`W/` prefix is ignored - and a request carrying `Cache-Control: no-cache` is never fresh.
`sendNotModified` sets `304`; the validators stay on the response, as a `304` should carry them.

`cacheControl` builds a `Cache-Control` value from named directives, durations in seconds:

```ts
import { cacheControl } from 'ohne/utils';

useResponse().headers.set('cache-control', cacheControl({ public: true, maxAge: 3600 }));
// -> 'public, max-age=3600'
```

## Serving files

`sendFile` serves a UTF-8 file from the first of its roots that contains it. The path is resolved
against each root and confined to it - `..` and absolute paths cannot escape - and when no root
has the file, it throws a `404`:

```ts
// api/assets/[...path].get.ts
import { defineHandler, sendFile } from 'ohne';

export default defineHandler(({ params }) => sendFile(['public'], params.path));
```

Call it inside a request and return its result as the body. The response carries a weak `ETag`
from the file's size and modification time, so a repeat request short-circuits to `304` on the
stat alone - the file is never read. The default `Cache-Control` is `no-cache`: cached, but
revalidated on every use. Pass `cache` to change it, and `notFound` to override the `404` message:

```ts
sendFile(['public'], params.path, {
  cache: { public: true, maxAge: 86400 },
  notFound: 'No such asset',
});
```

A TypeScript file (`.ts` / `.mts`) is stripped to JavaScript on the fly and served as a module -
the same stripping Node uses to run `.ts`, pointed at the browser. It is how
[dashboard pages](../dashboard/pages.md) reach the browser. Any other file gets the content type
for its extension.

## Server-sent events

`sendEvents` opens a Server-Sent Events stream. It sets `text/event-stream`, returns the controls
to push and end the stream, and the body you return from the handler. The socket stays open until
you close it or the client disconnects:

```ts
// api/clock.get.ts
import { defineHandler, sendEvents } from 'ohne';

export default defineHandler(() => {
  const stream = sendEvents({ onClose: () => clearInterval(timer) });
  const timer = setInterval(() => stream.send(new Date().toISOString()), 1000);
  return stream.body;
});
```

The browser reads it with `EventSource`:

```ts
const clock = new EventSource('/clock');
clock.onmessage = (event) => console.log(event.data);
```

Each `send` pushes one event. The second argument names the frame: `event` emits a typed event the
browser dispatches under that name, `id` sets the id it replays as `Last-Event-ID` on reconnect. A
multi-line payload survives intact - each line becomes its own `data:` line.

`close` ends the stream and the socket; a `send` after that is a no-op. Either ending - yours or
the client's disconnect - runs `onClose` exactly once, the place to stop timers or drop the stream
from a broadcast set.

A client that stops reading does not buffer forever. Once 1024 frames sit unread, the stream closes
and `onClose` runs, exactly as if the client had disconnected - a stalled socket never grows the
server's memory.

## After the response

`waitUntil` keeps background work alive past the response. The response is sent immediately; the
promise runs after it, and a graceful shutdown waits for the work to settle. A rejection is
isolated and logged, never touching the already-sent response:

```ts
// api/subscribers.post.ts
import { defineHandler, waitUntil } from 'ohne';

export default defineHandler(async () => {
  const subscriber = await subscribe();
  waitUntil(sendWelcomeEmail(subscriber));
  return subscriber;
});
```

It is for short side effects - logging, analytics, a notification. Durable work belongs in a
queue, not here.

By default the work has no deadline. `api.waitUntilTimeout` in [config](../project/config.md)
bounds it - milliseconds or a duration like `'60s'` - and on overrun the promise is abandoned with
an error line, releasing its hold on shutdown. A single route overrides the limit through
`defineHandler` options:

```ts
export default defineHandler(() => track(), { waitUntilTimeout: '5s' });
```
