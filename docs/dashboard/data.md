# Data in the dashboard

A dashboard page runs in the browser, so its data comes over HTTP from your API. `api` is the
fetch for that: it knows every route id your project registers, prefixes the API's base URL, and
returns the plain `Response`. Messages arrive the same way: `useT` translates against catalogs
fetched from the API on demand.

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
- A bare-path id uploads with `POST`.
- Pass a `signal` to cancel. The promise rejects with an `AbortError`, as `fetch` does.

## Translations in the browser

`useT` returns a translator with the same typed keys as the server's. Codegen copies
[`KnownMessages`](../i18n/messages.md#typed-keys) into the browser, so an unknown key or a wrong
parameter is a compile error. Call `t` inside a reactive child so the string stays up to date:

```ts
import { h, useT } from 'ohnejs/dashboard';

const t = useT();

h('h1', null, () => t('page.title'));
h('p', null, () => t('field.minLength', { min: 3 }));
```

Groups load on demand through the [catalog endpoint](../i18n/messages.md#the-catalog-endpoint):
the first `t('page.title')` fetches the `page` group for the active language, once, and caches it.
Until the group arrives, the key itself renders. The same happens for a key that no catalog defines.
When a key is missing in the active language, the server fills it from the
[fallback chain](../i18n/messages.md#translating-with-uset).

## Switching the language

`useDashboardLanguage` returns the ref that holds the language the dashboard renders messages in.
The whole page shares one ref:

- It starts at the configured [default language](../project/config.md#messages).
- It switches to the signed-in user's [dashboard language](./account.md#the-settings) once the
  session has loaded.
- Writing a new language tag re-renders every `useT` string in place.

`api()` sends the active language as `Accept-Language`, so labels and messages that the server
resolves arrive in the same language:

```ts
import { h, useDashboardLanguage } from 'ohnejs/dashboard';

const language = useDashboardLanguage();

h('button', { onClick: () => (language.value = 'de') }, 'Deutsch');
```

Codegen types the ref to the languages your catalogs define, so `'de'` compiles only when a `de`
catalog exists somewhere in the stack.
