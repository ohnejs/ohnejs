# HTTP errors

A request that cannot be served answers with an `HTTPError`: a status code, a message, and an
optional payload. Throw one from a handler - or return it - and it becomes the response:

```ts
// api/authors/[id].get.ts
import { defineHandler, notFound, query } from 'ohnejs';

export default defineHandler(async ({ params }) => {
  const author = await query('Authors').where('UUID', params.id).findFirst();
  if (!author) throw notFound('No such author');
  return author;
});
```

The client receives the error's status and a JSON body:

```json
{ "statusCode": 404, "message": "No such author" }
```

The shape is fixed: `statusCode` repeats the status, `message` carries the message, and `data`
appears only when you attach one (below).

## Named constructors

There is one constructor for each common status, and you import each from `ohnejs`:

```
badRequest()           400 Bad Request
unauthorized()         401 Unauthorized
forbidden()            403 Forbidden
notFound()             404 Not Found
conflict()             409 Conflict
payloadTooLarge()      413 Content Too Large
unsupportedMediaType() 415 Unsupported Media Type
unprocessable()        422 Unprocessable Content
tooManyRequests()      429 Too Many Requests
```

Each takes an optional message and optional data. If you omit the message, the status's standard
reason phrase is used - `notFound()` answers with `Not Found`. For any other status, build the
error directly:

```ts
import { HTTPError } from 'ohnejs';

throw new HTTPError(418, "I'm a teapot");
```

The framework throws these itself when the request is wrong:

- A body over [`api.maxBodySize`](../project/config.md#the-api-server) is a `413`.
- A [JSON body reader](./request.md#the-body) given the wrong `Content-Type` is a `415`.
- A malformed body is a `400`.

## Attaching data

The second argument is sent under `data`. It is machine-readable detail the client can act on:

```ts
throw unprocessable('Password too short', { field: 'password' });
```

```json
{ "statusCode": 422, "message": "Password too short", "data": { "field": "password" } }
```

`data` is serialized into the body unchanged, so never put anything there that you would not show
the client.

## Unhandled errors

Any other throw inside a request, such as a bug, a rejected promise, or an error you did not map,
becomes a generic response:

```json
{ "statusCode": 500, "message": "Internal Server Error" }
```

Nothing of the real error reaches the client: no message, no stack. The server logs it instead as
an error block naming the route, and the stack shows only under
[`DEBUG`](../project/env.md#the-built-ins). A handler that throws never stops the server: the
request is answered and the process keeps serving.

To replace the generic response, such as with a branded error page, filter it with the
[`error:response`](./hooks.md#errorresponse) hook.

## Write failures

Database writes turn their own failures into responses:

- A [validation failure](../database/writing.md#the-result) becomes a `422` whose `data.errors`
  gives each failing field a message.
- A [busy database](../database/engine.md#transactions) becomes a `503` with `Retry-After`.
- A [delete blocked](../database/writing.md#deleting-records) by a referencing record becomes a
  `409`.

## Translated messages

The default messages are message keys: `notFound()` reads `api.http.notFound` from the
[catalogs](../i18n/messages.md#catalogs), so they resolve in the request's language. The
[field messages](../i18n/messages.md#validation-messages) inside a write's `422` resolve the same
way. A message you pass yourself is sent unchanged.
