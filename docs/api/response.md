# Shaping the response

A handler returns its value and ohne serializes it: an object becomes JSON, a string becomes HTML,
and an empty return becomes `204`. [What a return becomes](./routes.md#what-a-return-becomes) has
the full rules. You shape the rest of the response (status, headers, redirects, caching, streams)
with composables you call inside the handler. Call them anywhere inside the request, at any depth.

## Status and headers

`setResponseStatus` sets the status, the common case:

```ts
// api/subscribers.post.ts
import { defineHandler, setResponseStatus } from 'ohnejs';

export default defineHandler(async () => {
  const subscriber = await subscribe();
  setResponseStatus(201);
  return subscriber;
});
```

`useResponse()` gives you the whole response state: assign `status`, and change `headers` in place.
`headers` is a standard `Headers`, so `set`, `append`, and `delete` all work:

```ts
// api/export.get.ts
import { defineHandler, useResponse } from 'ohnejs';

export default defineHandler(() => {
  useResponse().headers.set('cache-control', 'no-store');
  return { ok: true };
});
```

You still return the body. These only set the status and headers around it, and ohne reads them
after the handler returns.

## Redirects

`sendRedirect` sets the status and the `Location` header together. The status defaults to `302`:

```ts
// api/old-posts.get.ts
import { defineHandler, sendRedirect } from 'ohnejs';

export default defineHandler(() => sendRedirect('/posts', 301));
```

It returns nothing, so the handler's body is empty, and ohne sends it with the redirect status.

## Caching

The conditional-request pattern has three steps:

1. `etag` computes a validator you put on the response.
2. `isFresh` asks whether the client's cached copy is still fresh.
3. `sendNotModified` answers `304` when it is.

```ts
// api/posts.get.ts
import { defineHandler, isFresh, query, sendNotModified, useResponse } from 'ohnejs';
import { etag } from 'ohnejs/utils/etag';

export default defineHandler(async () => {
  const posts = await query('Posts').findMany();

  useResponse().headers.set('etag', etag(JSON.stringify(posts)));
  if (isFresh()) return sendNotModified();

  return posts;
});
```

`isFresh` compares the request's `If-None-Match` / `If-Modified-Since` against the `ETag` /
`Last-Modified` you set on the response, so set the validator first.

- The comparison is weak: a `W/` prefix is ignored.
- A request carrying `Cache-Control: no-cache` is never fresh.
- `sendNotModified` keeps the validators on the response, because a `304` should include them.

`cacheControl` builds a `Cache-Control` value from named directives, with durations in seconds:

```ts
import { cacheControl } from 'ohnejs/utils';

useResponse().headers.set('cache-control', cacheControl({ public: true, maxAge: 3600 }));
// -> 'public, max-age=3600'
```

## Serving files

`sendFile` serves a file from the first of its root directories that contains it. The path is
resolved against each root and must stay inside it, so `..` and absolute paths cannot escape. When
no root has the file, it throws a `404`:

```ts
// api/assets/[...path].get.ts
import { defineHandler, sendFile } from 'ohnejs';

export default defineHandler(({ params }) => sendFile(['public'], params.path));
```

Call it inside a request and return its result as the body.

- The response carries a weak `ETag` built from the file's size and modification time. On a repeat
  request for an unchanged file, ohne checks only those two values and answers `304` without reading
  the file.
- The default `Cache-Control` is `no-cache`: cached, but checked with the server on every use. Pass
  `cache` to change it.
- Pass `notFound` to override the `404` message.

```ts
sendFile(['public'], params.path, {
  cache: { public: true, maxAge: 86400 },
  notFound: 'No such asset',
});
```

A file gets the content type for its extension. For a TypeScript file (`.ts` / `.mts`), ohne strips
the types while serving it and sends it as a JavaScript module. Node uses the same stripping to run
`.ts`. That is how [dashboard pages](../dashboard/pages.md#serving) reach the browser.

## Server-sent events

`sendEvents` opens a Server-Sent Events stream. It sets `text/event-stream` and returns the controls
to push events and end the stream, together with the body you return from the handler. The socket
stays open until you close it or the client disconnects:

```ts
// api/clock.get.ts
import { defineHandler, sendEvents } from 'ohnejs';

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

Each `send` pushes one event. A multi-line payload stays complete: each of its lines becomes one
`data:` line. The second argument sets the event's name and id:

- `event` emits a typed event the browser dispatches under that name.
- `id` sets the id the browser sends back as `Last-Event-ID` when it reconnects.

`close` ends the stream and the socket, and a `send` after that does nothing. Either ending, yours
or the client's disconnect, runs `onClose` exactly once. Use it to stop timers or remove the stream
from a broadcast set.

A client that stops reading is disconnected. Once 1024 frames wait unread, the stream closes and
`onClose` runs, so such a client cannot use up the server's memory.

## After the response

`waitUntil` keeps background work running after the response. The response is sent immediately, the
promise runs after it, and a [graceful shutdown](../production/deployment.md#graceful-shutdown)
waits for the work to finish. If the promise rejects, ohne logs the error, and the response that was
already sent is not affected:

```ts
// api/subscribers.post.ts
import { defineHandler, waitUntil } from 'ohnejs';

export default defineHandler(async () => {
  const subscriber = await subscribe();
  waitUntil(sendWelcomeEmail(subscriber));
  return subscriber;
});
```

It is for short side effects such as logging, analytics, or a notification. Work that must not be
lost belongs in a queue, not here.

By default the work has no time limit. [`api.waitUntilTimeout`](../project/config.md#the-api-server)
sets one, in milliseconds or as a duration like `'60s'`. When the work takes longer, ohne logs an
error line and stops waiting for the promise, so it no longer delays shutdown. A single route
overrides the limit through its [options](./routes.md#per-route-options):

```ts
// api/track.post.ts
import { defineHandler } from 'ohnejs';

export default defineHandler(() => track(), { waitUntilTimeout: '5s' });
```
