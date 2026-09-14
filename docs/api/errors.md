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

The shape is fixed: `statusCode` mirrors the status, `message` carries the message, and `data`
appears only when you attach one (below).

## Named constructors

One constructor per common status, each importable from `ohnejs`:

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

Each takes an optional message and optional data. Omit the message and the status's standard
reason phrase is used - `notFound()` answers with `Not Found`. For any other status, build the
error directly:

```ts
import { HTTPError } from 'ohnejs';

throw new HTTPError(418, "I'm a teapot");
```

The framework throws these itself where the request is at fault: a body over `server.maxBodySize`
is a `413`, a JSON body reader given the wrong `Content-Type` a `415`, a malformed body a `400`.

## Attaching data

The second argument rides along under `data` - machine-readable detail the client can act on:

```ts
throw unprocessable('Password too short', { field: 'password' });
```

```json
{ "statusCode": 422, "message": "Password too short", "data": { "field": "password" } }
```

`data` is serialized into the body verbatim, so never put anything there you would not show the
client.

## Unhandled errors

Any other throw inside a request - a bug, a rejected promise, an error you did not map - becomes
a generic response:

```json
{ "statusCode": 500, "message": "Internal Server Error" }
```

Nothing of the real error reaches the client: no message, no stack. The server logs it instead as
an error block naming the route; the stack shows only under `DEBUG`. A throwing handler never
takes the server down - the request is answered and the process keeps serving. Failures inside a
request are always HTTP concerns, mapped to a response; the process-level error printing you see
when a boot fails is reserved for failures outside requests.

## Write failures

Database writes map their own failures: a validation failure becomes a `422` whose `data.errors`
keys each failing field to a message, a busy database a `503` with `Retry-After`, and a delete
blocked by a referencing record a `409`. See [writing records](../database/writing.md#the-result).

## Translated messages

The default messages are message keys - `notFound()` reads `api.http.notFound` from the catalogs -
so they resolve in the request's language, and the field messages inside a write's `422` resolve
the same way. A message you pass yourself is sent verbatim. See
[messages](../i18n/messages.md).
