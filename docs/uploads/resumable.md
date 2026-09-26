# Resumable uploads

A large file can go up in chunks, one request each. A proxy's body limit then caps a chunk, not
the file, and a dropped connection, a reload, or an API restart costs only the chunk in flight.
The file lands exactly as [`POST /uploads`](./uploads.md#uploading-over-http) would store it.

The dashboard does this for every file larger than `uploads.chunkSize`, `8mb` by default.

## In the dashboard

The upload bell tracks each upload:

- A dropped connection or a restarting API shows `Reconnecting`, and the request is sent again
  after 1, 2, 4, 8, and 16 seconds. After that, the upload fails.
- A failed upload offers `Retry` in the bell and its toast, continuing where the server stands.
- After a reload, each of your unfinished uploads shows as `Interrupted`, unless another tab is
  sending it. A browser forgets files on reload, so `Resume` asks you to pick it again.
  Dropping the same file into the same folder continues it too.
- `Abort` drops the bytes the server holds. So does hiding a failed or interrupted upload, unless
  another tab is sending it.

To send every file whole, [disable](../project/config.md#disabling) `POST /uploads/sessions`.

## Over HTTP

A session runs through these routes:

```
POST   /uploads/sessions                    { "name": "Arthas.mp4", "size": 20971520 }
PATCH  /uploads/sessions/[uuid]             upload-offset: N, the body is the chunk at byte N
POST   /uploads/sessions/[uuid]/complete    lands the file, answers 201 with the record
DELETE /uploads/sessions/[uuid]             drops the session and its bytes, answers 204
```

`directory` is optional, as for `POST /uploads`. Opening a session and sending a chunk both answer
with the session, whose `offset` is where the next chunk starts:

```json
{
  "UUID": "019...",
  "directory": "films",
  "name": "arthas.mp4",
  "type": "video/mp4",
  "size": 20971520,
  "chunkSize": 8388608,
  "offset": 0,
  "expiresAt": 1790000000000,
  "upload": null
}
```

`upload` is the landed file's `UUID`, `null` until completion.

To send a 20 MiB file by hand, split it into chunks of `chunkSize`:

```sh
split -b 8388608 arthas.mp4 chunk.
```

That writes `chunk.aa`, `chunk.ab`, and the last 4 MiB in `chunk.ac`. Open a session:

```sh
curl -X POST http://localhost:9001/uploads/sessions \
  -H 'content-type: application/json' --cookie "session=..." \
  -d '{"directory": "films", "name": "Arthas.mp4", "size": 20971520}'
```

It answers `201` with the session. Put its `UUID` in `$UUID` and send each chunk with its offset
in `Upload-Offset`:

```sh
curl -X PATCH "http://localhost:9001/uploads/sessions/$UUID" \
  -H 'upload-offset: 0' --data-binary @chunk.aa --cookie "session=..."
curl -X PATCH "http://localhost:9001/uploads/sessions/$UUID" \
  -H 'upload-offset: 8388608' --data-binary @chunk.ab --cookie "session=..."
curl -X PATCH "http://localhost:9001/uploads/sessions/$UUID" \
  -H 'upload-offset: 16777216' --data-binary @chunk.ac --cookie "session=..."
```

Each answers `200` with the session, its `offset` now `8388608`, `16777216`, then `20971520`. Land
the file:

```sh
curl -X POST "http://localhost:9001/uploads/sessions/$UUID/complete" --cookie "session=..."
```

It answers `201` with the record, whose `path` is `films/arthas.mp4`.

## The rules

- Every route needs the `collection.Uploads.create`
  [capability](../auth/roles.md#the-collections-api-guard). A session answers only the user who
  opened it, and anyone else a `404`.
- A chunk starts at a multiple of `chunkSize` and holds `chunkSize` bytes, the last one the rest.
  A chunk past `chunkSize` is a `413`, any other chunk off that grid a `400`, and so is one without
  `Content-Length` or `Upload-Offset`.
- Chunks go in order. A chunk at any other offset is a `409` whose `data` is the session, answered
  [before the body is read](../api/request.md#the-body). Continue from `data.offset`.
- Requests on one session take turns. After an API crash mid-request, the next one waits up to
  20 seconds.
- `complete` doubles as the probe: while bytes are missing, it answers `409` with the session.
  After landing, a repeat answers `200` with the same record.
- The first chunk is checked against the type of the name's extension. A mismatch is a `422` and
  ends the session.
- A `422` at completion, such as a file in the way of a folder, keeps the session, to complete
  again or to delete.
- An expired session's bytes are gone, and a `PATCH` or `complete` answers `404`. The first answer
  says the session expired. Later ones, or any after a [sweep](./storage.md#stray-files), are a
  plain `404`.

## In server code

The same steps are functions in `ohnejs/uploads`. This route lands an upload as a film's
`trailer`, a [`file` field](./fields.md):

```ts
// api/films/[id]/trailer.post.ts
import { defineHandler, query, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { completeUploadSession } from 'ohnejs/uploads';

export default defineHandler(
  async ({ params }) => {
    const user = await requireCapability('collection.Films.update');
    const { session } = await readJSONBody<{ session: string }>();
    const { record } = await completeUploadSession(session, { author: user.UUID });
    await query('Films').where('UUID', params.id).updateOrThrow({ trailer: record.UUID });
    return record;
  },
  { handlerTimeout: false },
);
```

- The route lifts [`api.handlerTimeout`](../project/config.md#the-api-server), since landing a
  large file can outlast it.
- `createUploadSession`, `readUploadSession`, `writeUploadChunk`, `completeUploadSession`, and
  `abortUploadSession` do what the routes do, and throw the same errors.
- `createUploadSession` records its `author` as the owner. The other helpers, given an `author`,
  reach only that user's sessions, and without one, any session.
- `completeUploadSession` resolves `{ record, created }`, and `created` is `false` on a repeat.
- `sweepUploadSessions` discards every expired session, as `abortUploadSession` does. It skips one
  a request is busy with, for the next sweep.

## Sizes and limits

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: { chunkSize: '8mb', sessionMaxAge: '1d' },
});
```

- `chunkSize` - the size of every chunk but the last, `64kb` or more, since a file's type is
  checked by its first `64kb`. Keep it under the body limit of any proxy in front of the API, such
  as nginx's `client_max_body_size`.
- The API buffers each chunk whole, so each one in flight holds `chunkSize` of memory.
- A session keeps the `chunkSize` it opened with. Lower the setting under it, and every full chunk
  it still has to send answers `413`.
- `sessionMaxAge` - how long an upload has from opening to completion. Nothing extends it.
- `maxFileSize`, `maxSVGSize`, and `types` are checked when the session opens.
- [`api.requestTimeout`](../project/config.md#the-api-server) bounds each chunk, not the whole file.

## Storage support

A [backend](./storage.md#a-backend-of-your-own) resumes uploads when it implements `parts`:

- `fs` has it.
- [`@ohnejs/uploads-s3`](./storage.md#storing-files-in-s3) has it. Keep `chunkSize` at `5mb` or more
  there, and give the bucket the lifecycle rule from its
  [README](https://github.com/ohnejs/uploads-s3#bucket-setup).
- Without it, opening a session answers `501`, and the dashboard sends every file whole.

## What goes up whole

The upload button of a [media field](./fields.md) and `Replace file` in a file's details send the
file in one request, bounded by `maxFileSize` and `api.requestTimeout`.
