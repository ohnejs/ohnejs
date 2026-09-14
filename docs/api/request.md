# Reading the request

Inside a handler you read the request through composables - small functions like `useRequest` and
`useSearchParams` that you call instead of threading a request object through your code. Each
request runs in its own async scope, so any function a handler calls - however deep, across every
`await` - reads the same request. Middleware shares the scope too.

```ts
// api/search.get.ts
import { defineHandler, useSearchParams } from 'ohnejs';

export default defineHandler(() => {
  const { q } = useSearchParams();
  return { query: q };
});
```

## The event

`useEvent()` returns the request's `Event`, the one object every composable reads from. It carries
the inbound `request` and parsed `url`, the matched route `params`, the client `ip` (an empty
string when the transport cannot resolve one), the mutable `response` state, and `context`.

```ts
const event = useEvent();

event.request.method // -> 'GET'
event.url.pathname   // -> '/search'
event.ip             // -> '203.0.113.7'
```

Outside a request there is no event, so `useEvent()` throws. `tryUseEvent()` is the non-throwing
counterpart, returning `undefined`, for code that runs with or without a request.

`context` is an extensible per-request bag. It starts empty; [middleware](./middleware.md) fills
it - an auth session, a resolved user. Augment its type from your app with `declare module`:

```ts
declare module 'ohnejs' {
  interface EventContext {
    auth: Session;
  }
}
```

The `response` side of the event - status, headers - is covered in
[shaping the response](./response.md).

## The request

`useRequest()` returns the inbound request as the Web standard `Request`, shorthand for
`useEvent().request`. Method, headers, everything the platform type offers:

```ts
useRequest().method                    // -> 'POST'
useRequest().headers.get('user-agent') // -> the header value
```

## Route params

`useRouteParams()` returns the values the route pattern captured, keyed by name. A `[id]` segment
becomes `params.id`; a catch-all `[...path]` captures the rest of the path, slashes included, as
`params.path`. Values are always strings, URI-decoded.

```ts
// api/authors/[id].get.ts, matched against /authors/42
import { defineHandler, useRouteParams } from 'ohnejs';

export default defineHandler(() => {
  return { id: useRouteParams().id };
});
```

The handler's context argument carries the same map, so `defineHandler(({ params }) => ...)` works
too, and annotating the context narrows `params` to specific keys. The file-naming convention that
produces the pattern lives in [route files](./routes.md).

## Search params

`useSearchParams()` parses the URL query into a structured object. Values carry their own type:

```ts
// GET /search?q=ohne&page=2&draft=true&tags=[new,sale]
useSearchParams() // -> { q: 'ohne', page: 2, draft: true, tags: ['new', 'sale'] }
```

The grammar:

- `1` is a number, `true` and `false` booleans, `null` is `null`.
- `[a,b]` is a list, `{k:v}` an object; both nest freely.
- A leading backtick forces a string: `` `1 `` is the string `'1'`.
- A bare key with no value is `true`: `?draft` is `{ draft: true }`.
- A repeated key collects into an array: `?t=1&t=2` is `{ t: [1, 2] }`.

Typed values cut both ways: `?id=42` arrives as the number `42`, not the string `'42'`. The
coercion is conservative - only JSON-shaped numbers convert, so `?id=007` keeps its text (a
leading zero is not a number shape) and an integer past the safe range keeps every digit. When a
value must arrive as text whatever its shape, send it with the backtick: ``?id=`42`` is `'42'`.

Untrusted input never throws: a malformed value falls back to its decoded string, and nesting
caps at 32 levels. For the raw, uncoerced `URLSearchParams`, read `useEvent().url.searchParams`.

This same grammar drives [querying over HTTP](./url-queries.md), where `where`, `order`, and the
rest of the query surface are structured values in the URL.

## The body

Four readers, one per shape. Each is valid only within a request:

```ts
// api/subscribers.post.ts
import { defineHandler, readJSONBody } from 'ohnejs';

export default defineHandler(async () => {
  const input = await readJSONBody<{ email: string }>();
  return { subscribed: input.email };
});
```

- `readJSONBody<T>()` parses a JSON body. The `Content-Type` must be `application/json` or carry
  a `+json` suffix; anything else rejects with `415`. An empty or malformed body rejects with
  `400`. The result is typed as `T` but unverified - validate it before you trust it.
- `readTextBody()` reads the body as a UTF-8 string, `''` when there is none. Invalid UTF-8
  rejects with `400`.
- `readFormBody()` reads a form into `FormData`. It accepts `multipart/form-data` and
  `application/x-www-form-urlencoded`; any other `Content-Type` rejects with `415`, a malformed
  body with `400`. An absent body yields empty `FormData`.
- `readRawBody()` returns the bytes as a `Uint8Array`, or `undefined` when there is no body.

The stream is consumed once and memoized: every reader reuses the same bytes, so reading twice -
or as text after raw - costs nothing and never fails on a spent stream.

Bodies are bounded by `server.maxBodySize`, `'1mb'` by default; an over-cap body is refused with
`413`. Raise it in [config](../project/config.md), or per route through `defineHandler` options.

## Cookies

`useCookies()` parses the `Cookie` header into a map of name to value:

```ts
// Cookie: id=42; theme=dark
useCookies() // -> { id: '42', theme: 'dark' }
```

`setCookie` appends a `Set-Cookie` header - one call per cookie - and `deleteCookie` clears one
by expiring it. Pass the same `domain`/`path` the cookie was set with; a browser only clears a
matching cookie:

```ts
setCookie('theme', 'dark', { path: '/', maxAge: 31536000 });
deleteCookie('theme', { path: '/' });
```

Options cover the full attribute surface: `domain`, `path`, `expires`, `maxAge`, `httpOnly`,
`secure`, `sameSite`, `partitioned`, and `priority`.

### Signed cookies

A signed cookie proves the value left your server unmodified. `setSignedCookie` signs with the
`COOKIE_SECRET` env var and defaults to `httpOnly`, `secure`, and `sameSite: 'lax'` - the safe
profile for a session:

```ts
setSignedCookie('session', userId);
```

`useSignedCookies()` returns only the cookies whose signature verifies; tampered, unsigned, and
renamed ones are dropped. The signature binds the cookie's name too, so a valid value cannot be
replayed under another name.

```ts
useSignedCookies() // -> { session: 'u42' }
```

Signing is not encryption: the value still travels readable, so never sign a secret. And with no
`COOKIE_SECRET` set, signing throws - the app fails loud instead of signing under a blank key.

## Content negotiation

`useAccepts` picks the best response media type for the `Accept` header from what you can
produce; `useAcceptsLanguages` does the same for `Accept-Language`. Both return the chosen offer,
or `undefined` when the client accepts none of them, and both append the header they read to the
response `Vary`.

```ts
// Accept-Language: de-AT, de;q=0.9, en;q=0.5
useAcceptsLanguages(['en', 'de']) // -> 'de'
```

A request without the header accepts anything, so the first offer wins - put your preferred
format first.

## Authorization

`useAuthorization()` parses the `Authorization` header into its scheme and credentials, or
returns `null` when the header is absent or carries none. The scheme is lowercased; the token is
kept verbatim. A `basic` token is additionally decoded into `username` and `password`:

```ts
// Authorization: Bearer abc.def
useAuthorization() // -> { scheme: 'bearer', token: 'abc.def' }

// Authorization: Basic dXNlcjpwYXNz
useAuthorization()
// -> { scheme: 'basic', token: 'dXNlcjpwYXNz', username: 'user', password: 'pass' }
```

Finally, the request carries a language: `useT()` translates in it, negotiated from
`Accept-Language` or forced by a middleware through `context.locale` - see
[messages](../i18n/messages.md).
