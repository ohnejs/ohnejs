# Uploads

The uploads layer gives your app a media library:

- files stored in a backend you can replace,
- an `Uploads` collection that lists them,
- routes to upload and serve them,
- [field types](./fields.md) that reference them from your own collections,
- a Media page in the dashboard.

It is a [layer](../project/layers.md#consuming-a-layer), so an app that does not need it does not
include it:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
});
```

That line is all you need to install it. Run the app, sign in to the dashboard, and the sidebar
shows Media.

## The dashboard

The layer ships the Media page at `/media`, with folders, drag and drop uploads, a details popup
for alt text and the focal point, and a picker that the [media fields](./fields.md) open.

The sidebar row replaces the `Uploads` collection's own row, so a viewer who is allowed to read
`Uploads` sees Media instead of the table. To place it yourself, list `'Uploads'` in
[`dashboard.menu`](../dashboard/pages.md#the-sidebar) where you want the row.

## The collection

`Uploads` holds one row per file and per folder:

- `directory` - the parent path, with no leading slash and `''` at the root.
- `name` - the file or folder name. The `directory` and `name` pair is unique, as on a filesystem,
  and every segment is a slug.
- `type`, `size`, `hash`, `focalX`, and `focalY` - on a file.
- `description` - a file's alt text, one per
  [content locale](../database/translations.md#marking-fields).
- `width` and `height` - on an image.
- `author` and `uploadedAt` - on every row.
- `private` - whether only a [signed link or a signed-in reader](./private-files.md) opens the
  bytes. Ignored while no `UPLOADS_SECRET` is set.

Every read is decorated with extra fields:

- `path` joins `directory` and `name`.
- `url` is where a file's bytes are served from.
- `variants` holds one signed URL per [named variant](./image-variants.md#named-variants), when an
  image service is configured.
- `expires` says when a [private file's](./private-files.md) `url` and `variants` stop working.

A folder is decorated with `path` only:

```ts
const upload = await query('Uploads').where('UUID', uuid).findFirst();

upload.path; // -> 'photos/2024/sunset.jpg'
upload.url; // -> '/uploads/photos/2024/sunset.jpg'
upload.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/2024/sunset.jpg'
```

Only `read` is exposed over the [collections API](../api/collections.md#exposure), and it is
guarded: the caller needs the `collection.Uploads.read`
[capability](../auth/roles.md#the-collections-api-guard). Every write goes through the
[routes](#uploading-over-http) or the [helpers](#in-server-code), which are the only code that moves
bytes.

To open that read to anyone, or limit it with [`access`](../api/collections.md#access), add your
own `collections/Uploads.ts`. It
[replaces the layer's `Uploads`](../project/layers.md#what-overrides-what) entirely, so spread
`uploadsDefinition` and change only the keys you need:

```ts
// collections/Uploads.ts
import { defineCollection } from 'ohnejs';
import { uploadsDefinition } from 'ohnejs/uploads';

export default defineCollection({
  ...uploadsDefinition,
  api: { read: 'public' },
});
```

## Uploading over HTTP

The request body is the file. One file per request, metadata in the query:

```
POST   /uploads?directory=photos&name=Sunset.JPG   the body is the file, answers 201 with the record
POST   /uploads/folders                             { "directory": "photos", "name": "2024" }
PATCH  /uploads/[uuid]                              { "name"?, "directory"?, "description"?, "focalX"?, "focalY"?, "private"? }
POST   /uploads/[uuid]/replace                      the body replaces the file's bytes
DELETE /uploads/[uuid]                              a folder takes everything inside it
POST   /uploads/move                                { "uuids": [...], "directory": "archive" }
POST   /uploads/private                             { "uuids": [...], "private": true }
POST   /uploads/delete                              { "uuids": [...] }
GET    /uploads/[uuid]/link?maxAge=7d               a temporary link to a private file
GET    /uploads/[...path]                           the bytes
```

```sh
curl -X POST 'http://localhost:9001/uploads?directory=photos&name=Sunset.JPG' \
  --data-binary @sunset.jpg --cookie "session=..."
```

When a file comes in:

- The name and directory are slugified, so the answer's `path` is `photos/sunset.jpg`.
- A name already taken gets a `-2` suffix.
- Missing folders are created.
- The file's type comes from its extension and is verified against its first bytes, so a PNG named
  `.jpg` is a `422`.
- An SVG is sanitized before it is stored.

Writes need the `collection.Uploads.*` capabilities of
[roles](../auth/roles.md#the-collections-api-guard). Changing, replacing, or deleting a row also
needs the `Uploads` read, and reaches only rows its [`access`](./private-files.md#who-can-open-the-bytes)
scope lets you see. Any other row is a `404`. The bytes are public unless the file is
[private](./private-files.md).

`PATCH` with `name` or `directory` renames or moves the row and its object, keeping a file's
extension. `?locale=` selects the alt text's locale.

The upload and replace routes accept bodies up to `uploads.maxFileSize` and run with no handler
timeout. An upload may take up to [`api.requestTimeout`](../project/config.md#the-api-server).
Unless you set it, that is Node's default of 5 minutes.

## Changing many rows at once

The bulk routes move, lock, or delete every row in `uuids` in one request. It is all or nothing:
if one row fails, nothing changes, and the answer is the error that row would get on its own.

```sh
curl -X POST 'http://localhost:9001/uploads/move' --cookie "session=..." \
  -H 'content-type: application/json' \
  --data '{ "uuids": ["0b7c...", "4f1e..."], "directory": "archive" }'
```

- `uuids` holds up to 1000 entries. Duplicates are dropped.
- An unknown `UUID`, or one you cannot see, is a `404`.
- A row inside a folder you also named goes along with that folder.
- A move skips rows already in `directory`. A folder moved into itself is a `422`.
- Move and privacy answer the records in the order you gave. Delete answers `204`.

## In server code

The same operations are functions in `ohnejs/uploads`, for a route or a boot file of your own:

```ts
import {
  createFolder,
  deleteUpload,
  deleteUploads,
  moveUpload,
  moveUploads,
  putUpload,
  updateUpload,
} from 'ohnejs/uploads';

const upload = await putUpload({ directory: 'imports', name: 'report.pdf', body });
await updateUpload(upload.UUID, { description: 'Quarterly report' }, { locale: 'de' });
await moveUpload(upload.UUID, { directory: 'archive/2026' });
const folder = await createFolder({ directory: 'archive', name: '2027' });
await moveUploads([upload.UUID], folder.path);
await deleteUpload(upload.UUID);
await deleteUploads([folder.UUID]);
```

- `body` is a web `ReadableStream`, which is what [`useRequest().body`](../api/request.md#the-body)
  gives you.
- Every helper throws the same errors the routes answer with.
- Every helper except the deletes returns the decorated record, an `UploadRecord`, or a list of them.
- `moveUploads`, `setUploadsPrivate`, and `deleteUploads` are all or nothing, like the bulk routes.

Changing `name` or `directory` directly through `query('Uploads')` does not move the object, so use
`moveUpload`.

`replaceUpload(uuid, body)` swaps a file's bytes and keeps its `UUID`, path, and type, so every
field that references it stays linked. Bytes that do not match the type are a `422`.

## Serving

`GET /uploads/<path>` streams the file with:

- its type,
- an `ETag` from the file's hash, so a fresh `If-None-Match` answers
  [`304`](../api/response.md#caching),
- `Cache-Control` from `uploads.cache`, `private` for a private file,
- `Range` support for video and audio.

Every answer is `nosniff`. A file whose type a browser would run as a document is downloaded as an
attachment. An SVG renders under a sandboxing content security policy.

Where a record's `url` points:

- With `publicURL` set, at that origin, and this route stays the origin behind it.
- Otherwise, when the backend has its own `url`, there.
- Otherwise, at this route.

A [private file's](./private-files.md) `url` always points at this route.

## Configuration

Every key under `uploads` is optional. These are the defaults:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: {
    storage: 'fs',
    url: '.uploads',
    maxFileSize: '128mb',
    types: '*',
    cache: { noCache: true },
    privateMaxAge: '1h',
    images: {
      variants: {
        thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' },
      },
    },
  },
});
```

- `storage` - the backend, by the name a boot file [registered](#storage) it under. The layer ships
  `fs`; [`@ohnejs/uploads-s3`](#storing-files-in-s3) adds `s3`.
- `url` - where the backend keeps the files, in whatever form it understands. For `fs` it is a
  directory, resolved against the working directory. For `s3` it is a bucket and prefix, as
  [Storing files in S3](#storing-files-in-s3) shows. The `UPLOADS_URL` env var overrides it.
- `maxFileSize` - the largest file that can be uploaded, as a `parseBytes` value.
- `types` - the media types that may be uploaded: `'*'`, or a list of exact types, `image/*`
  wildcards, and category names such as `document`, in the
  [media fields grammar](./fields.md#types).
- `cache` - the [`Cache-Control`](../api/response.md#caching) directives every served file carries.
  The default revalidates on every use, so a renamed or replaced file is never stale.
- `publicURL` - an origin that serves the stored files by their path, such as a CDN in front of
  the storage. Without it, records point where [serving](#serving) describes.
- `privateMaxAge` - how long a [private file's](./private-files.md) links stay valid, as a
  `parseDuration` value.
- `images` - the [image service](./image-variants.md) that renders resized variants, and the named
  variants every image read carries. `url` has no default, and without it every image URL points at
  the original.

`storage` and `url` are each layer's [own](../project/config.md#own-vs-inherited-keys): a dependency
cannot point your uploads at its storage.

## Storage

A file is stored under its path, `photos/2024/sunset.jpg`, and a folder is a prefix. The `fs`
backend keeps that layout as real files and directories under `uploads.url`.

To store files elsewhere, register a backend from a [boot file](../project/boot.md) and select it
by name:

```ts
// boot/storage.ts
import { useStorages } from 'ohnejs/uploads';

import { createGCSStorage } from '../storage/gcs.ts';

useStorages().register('gcs', (url) => createGCSStorage(url));
```

```ts
// ohne.config.ts
uploads: { storage: 'gcs', url: 'gs://my-bucket/uploads' },
```

A backend is a `StorageAdapter`:

- `write` stores a file.
- `read` returns a file, with an optional byte range.
- `stat` describes a file.
- `move` and `delete` take a prefix as well as a file, so a folder is one operation.
- `url` is optional, for a backend that serves its objects itself. A record's `url` then comes from
  the backend, unless `publicURL` is set.
- `setPrivate` is optional: it locks or unlocks a file or a prefix as a row turns
  [private](./private-files.md) or public. A `move` keeps what it set.
- `check` is optional: it confirms at boot that the backend can be reached.

The backend never sees the database. The layer's helpers record each move, delete, and
`setPrivate` inside the [transaction](../database/engine.md#transactions) that changes the rows,
and run it after the commit:

- A failed one is retried later and at every boot, so a crash never leaves a row pointing nowhere.
- A retry can repeat an effect that already ran, so a missing path must be a no-op.

The `fs` backend writes a file to a temp file beside its target and renames it into place. It
removes empty parent directories after a delete, and moves a folder in one rename.

## Storing files in S3

For S3 and S3-compatible services, install
[`@ohnejs/uploads-s3`](https://github.com/ohnejs/uploads-s3).

```sh
pnpm add @ohnejs/uploads-s3
```

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/uploads-s3'],
  uploads: { storage: 's3', url: 's3://my-bucket/uploads?region=eu-central-1' },
});
```

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The
[package README](https://github.com/ohnejs/uploads-s3#readme) covers bucket setup, private files,
and services such as R2 and MinIO.
