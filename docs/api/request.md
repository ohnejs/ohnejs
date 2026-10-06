# Reading the request

Inside a handler you read the request through composables. These are small functions like
`useRequest` and `useSearchParams` that you call instead of passing a request object through your
code. They work anywhere inside a request, however deep the call, and middleware can use them too.

```ts
// api/search.get.ts
import { defineHandler, useSearchParams } from 'ohnejs';

export default defineHandler(() => {
  const { q } = useSearchParams();
  return { query: q };
});
```

## Search params

`useSearchParams()` parses the URL query into a structured object. Values carry their own type:

```ts
// GET /search?q=ohne&page=2&draft=true&tags=[new,sale]
useSearchParams() // -> { q: 'ohne', page: 2, draft: true, tags: ['new', 'sale'] }
```

The grammar:

- `1` is a number, `true` and `false` booleans, `null` is `null`.
- `[a,b]` is a list, `{k:v}` an object, and both nest freely.
- A leading backtick forces a string: `` `1 `` is the string `'1'`.
- A key with no value is `true`: `?draft` is `{ draft: true }`.
- A repeated key becomes an array: `?t=1&t=2` is `{ t: [1, 2] }`.

Typed values are not always what you want: `?id=42` arrives as the number `42`, not the string
`'42'`. When a value must arrive as text, whatever it looks like, send it with the backtick:
``?id=`42`` is `'42'`.

The coercion is careful, and untrusted input never throws:

- Only JSON-shaped numbers convert. `?id=007` stays text, since JSON numbers have no leading zero.
- An integer outside the safe range stays text, so it keeps every digit.
- A malformed value falls back to its decoded string.
- Nesting is limited to 32 levels.

For the raw, uncoerced `URLSearchParams`, read `useEvent().url.searchParams`.

[Querying over HTTP](./url-queries.md) uses this same grammar. There, `where`, `order`, and the
other query options are structured values in the URL.

## The body

There is one reader for each body shape, and each works only inside a request:

```ts
// api/subscribers.post.ts
import { defineHandler, readJSONBody } from 'ohnejs';

export default defineHandler(async () => {
  const input = await readJSONBody<{ email: string }>();
  return { subscribed: input.email };
});
```

- `readJSONBody<T>()` parses a JSON body. The `Content-Type` must be `application/json` or carry
  a `+json` suffix, and anything else rejects with `415`. An empty or malformed body rejects with
  `400`, and so does one nested deeper than `maxDepth`, 64 levels unless you pass another. The
  result is typed as `T` but not checked, so validate it before you trust it.
- `readTextBody()` reads the body as a UTF-8 string, `''` when there is none. Invalid UTF-8
  rejects with `400`.
- `readFormBody()` reads a form into `FormData`. It accepts `multipart/form-data` and
  `application/x-www-form-urlencoded`. Any other `Content-Type` rejects with `415`, and a malformed
  body with `400`. A missing body gives an empty `FormData`.
- `readRawBody()` returns the bytes as a `Uint8Array`, or `undefined` when there is no body.

The body is read once and remembered, so every reader reuses the same bytes. Read it as many times
as you like, in any shape.

`api.maxBodySize` limits the body size, `'1mb'` by default, and a larger body is refused with `413`.
Raise the limit in [config](../project/config.md#the-api-server), or
[per route](./routes.md#per-route-options).

A client that sends `Expect: 100-continue`, as curl does for a large body, waits before sending it.
The server tells it to go ahead when your handler first reads the body. If your handler answers
before reading, for example with a `401`, the body is never sent. A client stops waiting after a
while on its own, about a second for curl. A proxy that buffers request bodies, as nginx does by
default, takes the whole body anyway.

## Cookies

`useCookies()` parses the `Cookie` header into a map of name to value:

```ts
// Cookie: id=42; theme=dark
useCookies() // -> { id: '42', theme: 'dark' }
```

`setCookie` appends a `Set-Cookie` header, one call per cookie, and `deleteCookie` clears one by
expiring it. Pass the same `domain` and `path` the cookie was set with, since a browser only clears
a matching cookie:

```ts
setCookie('theme', 'dark', { path: '/', maxAge: 31536000 });
deleteCookie('theme', { path: '/' });
```

The options cover every cookie attribute: `domain`, `path`, `expires`, `maxAge`, `httpOnly`,
`secure`, `sameSite`, `partitioned`, and `priority`.

### Signed cookies

A signed cookie proves that nobody changed the value after it left your server. `setSignedCookie`
signs with the [`COOKIE_SECRET`](../project/env.md#the-built-ins) env var and defaults to
`httpOnly`, `secure`, and `sameSite: 'lax'`, the safe settings for a session:

```ts
setSignedCookie('session', userId);
```

`useSignedCookies()` returns only the cookies whose signature is valid. Changed, unsigned, and
renamed ones are dropped. The signature covers the cookie's name too, so a valid value cannot be
reused under another name.

```ts
useSignedCookies() // -> { session: 'u42' }
```

- Signing is not encryption. Anyone can still read the value, so never sign a secret.
- With no `COOKIE_SECRET` set, signing throws an error instead of signing with an empty key.

## Route params

`useRouteParams()` returns the same `params` the handler receives, from anywhere in the request:
`useRouteParams().id` reads an `[id]` segment. [Route params](./routes.md#route-params) covers the
naming. Annotating the handler's context narrows `params` to specific keys.

## Content negotiation

`useAccepts` takes the media types you can produce and picks the best one for the `Accept` header.
`useAcceptsLanguages` does the same for `Accept-Language`:

```ts
// Accept-Language: de-AT, de;q=0.9, en;q=0.5
useAcceptsLanguages(['en', 'de']) // -> 'de'
```

- Both return the chosen offer, or `undefined` when the client accepts none of them.
- Both append the header they read to the response `Vary`.
- A request without the header accepts anything, so the first offer wins. Put your preferred format
  first.

## Authorization

`useAuthorization()` parses the `Authorization` header into its scheme and credentials, or returns
`null` when the header is missing or has no credentials. The scheme is lowercased, and the token is
kept exactly as sent. A `basic` token is also decoded into `username` and `password`:

```ts
// Authorization: Bearer abc.def
useAuthorization() // -> { scheme: 'bearer', token: 'abc.def' }

// Authorization: Basic dXNlcjpwYXNz
useAuthorization()
// -> { scheme: 'basic', token: 'dXNlcjpwYXNz', username: 'user', password: 'pass' }
```

[Sessions](../auth/authentication.md#sessions) also accept a `Bearer` token in this header.

## Language

Every request has a language, and [`useT()`](../i18n/messages.md#translating-with-uset) translates
into it. ohne negotiates it from `Accept-Language`, or a middleware forces it through
`context.locale`.

## The request

`useRequest()` returns the incoming request as the Web standard `Request`, shorthand for
`useEvent().request`. You get the method, the headers, and everything else the standard type offers:

```ts
useRequest().method                    // -> 'POST'
useRequest().headers.get('user-agent') // -> the header value
```

When the client disconnects before you respond, for example by closing the tab, the request's
`signal` aborts. Pass it to a slow call that accepts a signal, such as `fetch`. The call then stops
early, since nobody is left to receive its result:

```ts
const report = await fetch('https://reports.example.com/daily', { signal: useRequest().signal });
```

The signal also aborts when a [graceful shutdown](../production/deployment.md#graceful-shutdown)
stops waiting for the request. Shutdown then waits for your `catch` and `finally`, so clean up there.

## The event

`useEvent()` returns the request's `Event`, the one object every composable reads from:

- `request` - the incoming `Request`.
- `url` - the parsed URL.
- `params` - the matched route params.
- `ip` - the client address, or an empty string when it is unknown. Behind a load balancer, set
  [`trustProxy`](../production/deployment.md#behind-a-proxy) to read the real client's address.
- `response` - the mutable response state, covered in
  [shaping the response](./response.md#status-and-headers).
- `context` - a per-request object you can extend.

```ts
const event = useEvent();

event.request.method // -> 'GET'
event.url.pathname   // -> '/search'
event.ip             // -> '203.0.113.7'
```

Outside a request there is no event, so `useEvent()` throws. `tryUseEvent()` returns `undefined`
instead of throwing. Use it in code that runs with or without a request.

`context` starts empty, and [middleware](./middleware.md#global-middleware) fills it, for example
with an auth session or a resolved user. Augment its type from your app with `declare module`:

```ts
// context.ts
import type { Session } from 'ohnejs/auth';

declare module 'ohnejs' {
  interface EventContext {
    auth: Session;
  }
}
```
