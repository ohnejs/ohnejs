# Data in the dashboard

A dashboard page runs in the browser, so its data comes over HTTP from your API. `api` is the
fetch for that: it knows every route id your project registers, prefixes the API's base URL, and
returns the plain `Response`. Messages arrive the same way: `useT` translates against catalogs
the dashboard loads from the API.

## Fetching from the API

`api` takes a route id and returns the raw `Response`. You read the body yourself:

```ts
import { api } from 'ohnejs/dashboard';

const response = await api('GET /authors');
const authors = await response.json();
```

The id is the method and path as the server registers it: a route file
[`api/authors.get.ts`](../api/routes.md#files-and-urls) is `GET /authors`. The id's method becomes
the request method and wins over `init.method`, so the route id alone decides how the request is
sent. A route that answers every method has a bare-path id, like `'/health'`.

The second argument is a standard `RequestInit`, passed through to `fetch`. A `POST` sends its
body there:

```ts
const response = await api('POST /authors', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Thrall' }),
});
const author = await response.json();
```

The path is appended to the API base URL, which the dashboard server injects into the shell. The
base URL is the first of:

1. [`API_URL`](../project/env.md#the-built-ins), when set.
2. The configured [`dashboard.apiURL`](../project/config.md#the-dashboard).
3. The API's own host and port.

## Error responses

`api` does not throw on an error status. Like `fetch`, it rejects only when the request itself
fails. A `404` resolves normally, so check `response.ok`. An error body always has the shape
described in [HTTP errors](../api/errors.md): `statusCode`, `message`, and
[`data`](../api/errors.md#attaching-data) when attached:

```ts
const response = await api(`GET /authors/${id}`);
if (!response.ok) {
  const { message } = await response.json();
  console.error(message);
}
```

A `401` resolves like any other status. When it comes from a route outside `/auth/`, it counts as an
[expired session](../auth/authentication.md#sessions). A page wrapped in `shell` from
[`app/components/shell.ts`](./pages.md#what-a-page-may-import) then opens a sign-in popup in place.

## Loading into a ref

Rendering is synchronous, so a page does not await its data. It renders empty, starts the fetch,
and writes the result to a [ref](./reactivity.md#ref) when it arrives. Writing the ref updates only
the DOM that reads it:

```ts
// dashboard/pages/authors.ts
import { api, defineDashboardPage, each, h } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

interface Author {
  UUID: string;
  name: string;
}

export default defineDashboardPage(() => {
  const authors = ref<Author[]>([]);

  api('GET /authors')
    .then((response) => response.json())
    .then((loaded: Author[]) => (authors.value = loaded));

  return h(
    'ul',
    null,
    each(
      () => authors.value,
      (author) => author.UUID,
      (author) => h('li', null, () => author().name),
    ),
  );
});
```

[`each`](./rendering.md#lists) and the [reactive children](./rendering.md#children) are covered
under rendering. The response body is untyped: `api` gives you the `Response`, and the annotation on
`loaded` is where you say what the route returns.

## Typed route ids

[`ohne dev`](../project/cli.md#ohne-dev) and [`ohne prepare`](../project/cli.md#ohne-prepare)
generate the ids into `.ohne/browser/routes.ts`, so your editor autocompletes them in `api`. The
generated `KnownAPIRoutes` holds one member per route across every layer. It is the same table the
server registers, and `ohne dev` keeps it up to date as you add route files.

The type stays open: it accepts any string as well as the known ids. That is what a
[param route](../api/routes.md#route-params) needs. Its id contains the pattern,
`GET /authors/[id]`, and you fill in the real value:

```ts
const response = await api(`GET /authors/${id}`);
```

## Uploading with progress

`fetch` cannot tell you how much of a body has been sent, so `apiUpload` sends one over
`XMLHttpRequest` instead. It takes the same route id and the bytes, and calls `onProgress` as they
are sent. A `File` is a `Blob`, so you can pass a picked or dropped file as is. `apiUpload` resolves
to the same `Response` that `api` would:

```ts
import { apiUpload } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

const percent = ref(0);

async function send(file: File): Promise<void> {
  const response = await apiUpload(`POST /avatars?name=${encodeURIComponent(file.name)}`, file, {
    headers: { 'content-type': file.type },
    onProgress: (loaded, total) => (percent.value = Math.round((loaded / total) * 100)),
  });
  const avatar = await response.json();
}
```

- The body arrives raw. On the server, `readRawBody` from [the request](../api/request.md#the-body)
  reads it.
- The base URL, the credentials, and the session check are the ones `api` applies.
- Authenticate the route with `useUser`, `requireUser`, or `requireCapability`, which refuse a
  [cross-site cookie write](../auth/authentication.md#cross-site-requests) that a raw body could send.
- A bare-path id uploads with `POST`.
- Pass a `signal` to cancel. The promise rejects with an `AbortError`, as `fetch` does.

## Translations in the browser

`useT` returns a translator with the same typed keys as the server's. Codegen copies
[`KnownMessages`](../i18n/messages.md#typed-keys) into the browser, so an unknown key or a wrong
parameter is a compile error:

```ts
// dashboard/pages/index.ts
import { defineDashboardPage, h, useT } from 'ohnejs/dashboard';

const t = useT();

export default defineDashboardPage(() => [
  h('h1', null, () => t('page.title')),
  h('p', null, () => t('field.minLength', { min: 3 })),
]);
```

The dashboard loads every catalog of its language through the
[catalog endpoint](../i18n/messages.md#the-catalog-endpoint) before the first page renders, so `t` is
ready inside your page.

Keep each `t` call inside a function child, so it follows a language switch and a catalog that arrives
late. A call outside one is a snapshot: it renders once and never changes.

If the API cannot answer, the page renders anyway, with the key itself in place of each missing message.
The dashboard keeps retrying, and each live `t` call fills in once the catalogs arrive.

Labels from the discovery data, like a field's `label` or a menu row's, arrive as messages. Render them
with `translateMessage`, inside a function child too:

```ts
h('span', null, () => translateMessage(field.label));
```

A key that no catalog defines renders as the key itself. When a key is missing in the active language,
the server fills it from the [fallback chain](../i18n/messages.md#translating-with-uset).

## Switching the language

`useDashboardLanguage` returns a read-only ref to the language on screen. The whole page shares it:

- It starts at the configured [default language](../project/config.md#messages).
- It switches to the signed-in user's [dashboard language](./account.md#the-settings) once the
  session has loaded.

To switch it yourself, call `setDashboardLanguage`. It loads the new language's catalogs, then switches
the text in place. The page keeps its state, like a draft or the scroll position:

```ts
import { h, setDashboardLanguage } from 'ohnejs/dashboard';

h('button', { onClick: () => void setDashboardLanguage('de') }, 'Deutsch');
```

A switch made while a navigation is pending lands together with the arriving page, so the page you
leave never changes language on its way out.

`api()` sends the language you asked for as `Accept-Language`, so messages that the server resolves,
like a validation error, arrive in it.

Codegen types the ref to the languages your catalogs define, so `'de'` compiles only when a `de`
catalog exists somewhere in the stack.
