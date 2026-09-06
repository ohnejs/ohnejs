# Data in the dashboard

A dashboard page runs in the browser, so its data comes over HTTP from your API. `api` is the
fetch for that: it knows every route id your project registers, prefixes the API's base URL, and
returns the plain `Response`. Messages arrive the same way - `useT` translates against catalogs
fetched from the API on demand.

## Fetching from the API

`api` takes a route id and returns the raw `Response` - reading the body is yours:

```ts
import { api } from 'ohne/dashboard';

const response = await api('GET /authors');
const authors = await response.json();
```

The id is the route exactly as the server registers it: the method, a space, the path - a route
file `api/authors.get.ts` registers `GET /authors`; see [routes](../api/routes.md). The leading
method becomes the request method, and the path is appended to the API base URL the dashboard
server injects into the shell - `API_URL` when set, else the configured `dashboard.apiURL`,
falling back to the API's own host and port. A route that answers every method has a bare-path
id, like `'/health'`.

The second argument is a standard `RequestInit`, passed through to `fetch`. A `POST` sends its
body there:

```ts
const response = await api('POST /authors', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Dieter Rams' }),
});
const author = await response.json();
```

The id's method wins over `init.method`, so the route id alone decides how the request is sent.

## Uploading with progress

`fetch` cannot tell you how much of a body has gone out, so `apiUpload` sends one over
`XMLHttpRequest` instead. It takes the same route id, the bytes - a `File` is a `Blob`, so a picked
or dropped file passes as is - and calls `onProgress` as they leave. It resolves the same
`Response` `api` would:

```ts
import { apiUpload } from 'ohne/dashboard';
import { ref } from 'ohne/utils';

const percent = ref(0);

async function send(file: File): Promise<void> {
  const response = await apiUpload(`POST /avatars?name=${encodeURIComponent(file.name)}`, file, {
    headers: { 'content-type': file.type },
    onProgress: (loaded, total) => (percent.value = Math.round((loaded / total) * 100)),
  });
  const avatar = await response.json();
}
```

The body arrives raw; on the server, `readRawBody` from [the request](../api/request.md#the-body)
reads it. The base URL, the credentials, and the session check are the ones `api` applies; a
bare-path id uploads with `POST`. Pass a `signal` to cancel: the promise rejects with an
`AbortError`, as `fetch` does.

## Typed route ids

`pnpm exec ohne prepare` generates `.ohne/browser/routes.ts`, which fills `KnownAPIRoutes` with
one member per route across every layer - the same table the server registers. Your editor then
autocompletes the ids in `api`, and `ohne dev` keeps them fresh as you add route files.

The type stays open: any string is accepted alongside the known ids. That is what a param route
needs - its id carries the pattern, `GET /authors/[id]`, and you substitute the real value:

```ts
const response = await api(`GET /authors/${id}`);
```

## Error responses

`api` does not throw on an error status. Like `fetch`, it rejects only when the request itself
fails; a `404` resolves normally, so check `response.ok`. An error body always carries the wire
shape from [HTTP errors](../api/errors.md) - `statusCode`, `message`, and `data` when attached:

```ts
const response = await api(`GET /authors/${id}`);
if (!response.ok) {
  const { message } = await response.json();
  console.error(message);
}
```

## Loading into a ref

Rendering is synchronous, so a page does not await its data - it renders empty, starts the fetch,
and lets a [ref](./reactivity.md) carry the result in. Writing the ref updates exactly the DOM
that reads it:

```ts
// dashboard/pages/authors.ts
import { api, defineDashboardPage, each, h } from 'ohne/dashboard';
import { ref } from 'ohne/utils';

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

`each` and the reactive children come from [rendering](./rendering.md). The response body is
untyped - `api` hands you the `Response`, and the annotation on `loaded` is where you say what
the route returns.

## Translations in the browser

`useT` returns a translator with the same typed keys as the server's: codegen mirrors
`KnownMessages` into the browser, so an unknown key or a wrong parameter is a compile error. Call
`t` inside a reactive child so the string stays live:

```ts
import { h, useT } from 'ohne/dashboard';

const t = useT();

h('h1', null, () => t('page.title'));
h('p', null, () => t('field.minLength', { min: 3 }));
```

Catalogs load through the API, one group per request - the first `t('page.title')` fetches the
`page` group for the active language, once, and caches it. Until it arrives, and for a key no
catalog defines, the key itself renders. A key missing in the active language is filled down the
fallback chain on the server, exactly as [messages](../i18n/messages.md) describes.

## Switching the language

`useDashboardLanguage` returns the ref the dashboard renders messages in - one singleton for the
whole page. It starts at the configured default language, takes the signed-in user's
[dashboard language](./account.md) once the session resolves, and writing a new tag re-renders
every `useT` string in place. `api()` sends the active language as `Accept-Language`, so labels
and messages the server resolves arrive in the same language:

```ts
import { h, useDashboardLanguage } from 'ohne/dashboard';

const language = useDashboardLanguage();

h('button', { onClick: () => (language.value = 'de') }, 'Deutsch');
```

Codegen types the ref to the languages your catalogs define, so `'de'` compiles only when a `de`
catalog exists somewhere in the stack.
