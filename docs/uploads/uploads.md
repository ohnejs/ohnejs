# Uploads

The uploads layer gives your app a media library: files stored behind a pluggable backend, an
`Uploads` collection that lists them, routes to upload and serve them, field types that reference
them from your own collections, and a Media page in the dashboard. It is a layer, so an app that
does not need it never carries it.

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs', 'ohnejs/uploads'],
});
```

That line is the whole install. Run the app, sign in to the dashboard, and the sidebar shows
Media.

## Configuration

Every key under `uploads` is optional; these are the defaults:

```ts
uploads: {
  storage: 'fs',
  url: '.uploads',
  maxFileSize: '128mb',
  types: '*',
  cache: { noCache: true },
  images: {
    variants: {
      thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' },
    },
  },
},
```

- `storage` - the backend, by the name a boot file registered it under. The layer ships `fs`.
- `url` - where the backend keeps the files, in whatever form it understands. For `fs` a
  directory, resolved against the working directory. The `UPLOADS_URL` env var overrides it.
- `maxFileSize` - the largest file an upload may carry, as a `parseBytes` value.
- `types` - the media types that may be uploaded: `'*'`, or a list of exact types, `image/*`
  wildcards, and category names such as `document`. See [fields](./fields.md#types) for the
  pattern grammar.
- `cache` - the `Cache-Control` directives every served file carries. The default revalidates on
  every use, so a renamed or replaced file is never stale.
- `publicURL` - an origin that serves the stored files by their path, such as a CDN in front of
  the storage. Omitted, a backend that serves its files itself names the URL; otherwise the API
  serves every file itself.
- `images` - the image service that renders resized variants, and the named variants every image
  read carries. `url` has no default; without it every image URL points at the original. See
  [image variants](./images.md).

`storage` and `url` are each layer's own: a dependency cannot point your uploads at its storage.

## Storage

A file is stored under its path, `photos/2024/sunset.jpg`, and a folder is a prefix. The `fs`
backend keeps that layout as real files and directories under `uploads.url`: a write lands in a
temp file beside its target and renames into place, a delete removes empty parent directories
behind it, and moving a folder is one rename.

A backend is a `StorageAdapter`: `write`, `read` with an optional byte range, `stat`, `move`,
`delete`, and an optional `url` for a backend that serves its objects itself. A record's `url` then
comes from the backend, unless `publicURL` is set. `move` and `delete` take a prefix as well as a
file, so a folder is one operation. Register one from a [boot file](../project/boot.md) and select
it by name:

```ts
// boot/storage.ts
import { useStorages } from 'ohnejs/uploads';

import { createS3Storage } from '../storage/s3.ts';

useStorages().register('s3', (url) => createS3Storage(url));
```

```ts
// ohne.config.ts
uploads: { storage: 's3', url: 's3://bucket?region=eu-central-1' },
```

The backend never sees the database. The layer's helpers record each move and delete inside the
transaction that changes the rows and run it after the commit. A failed one is retried later and at
every boot, so a crash never leaves a row pointing nowhere. A retry may repeat an effect that
already ran, so `move` and `delete` must treat a missing path as a no-op.

## The collection

`Uploads` holds one row per file and per folder. A row's location is `directory`, the parent path
with no leading slash and `''` at the root, plus `name`; the pair is unique, as on a filesystem,
and every segment is a slug. A file row also carries `type`, `size`, `hash`, `width` and `height`
for images, `description` as its alt text per content locale, and `focalX` and `focalY`. Every
row records its `author` and `uploadedAt`.

Every read is decorated. `path` joins the location, `url` is where a file's bytes are served from,
and `variants` holds one signed URL per named variant when an [image service](./images.md) is
configured. A folder carries `path` alone:

```ts
const upload = await query('Uploads').where('UUID', uuid).findFirst();

upload.path; // -> 'photos/2024/sunset.jpg'
upload.url; // -> '/uploads/photos/2024/sunset.jpg'
upload.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/2024/sunset.jpg'
```

Only `read` is exposed over the [collections API](../api/collections.md), and it is guarded: the
caller needs the `collection.Uploads.read` [capability](../auth/roles.md). Every write goes through
the routes below or the helpers, which are the only code that moves bytes.

To open that read to anyone, or scope it with [`access`](../api/collections.md#access), ship your
own `collections/Uploads.ts`. It replaces the layer's `Uploads` entirely, so spread
`uploadsDefinition` and change only what you name:

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
PATCH  /uploads/[uuid]                              { "name"?, "directory"?, "description"?, "focalX"?, "focalY"? }
POST   /uploads/[uuid]/replace                      the body replaces the file's bytes
DELETE /uploads/[uuid]                              a folder takes everything inside it
GET    /uploads/[...path]                           the bytes
```

```sh
curl -X POST 'http://localhost:9001/uploads?directory=photos&name=Sunset.JPG' \
  --data-binary @sunset.jpg --cookie "session=..."
```

The name and directory are slugified, so the answer's `path` is `photos/sunset.jpg`; a name
already taken gets a `-2` suffix. Missing folders are created on the way. The file's type comes
from its extension and is verified against its first bytes, so a PNG named `.jpg` is a `422`; an
SVG is sanitized before it is stored. Writes need the `collection.Uploads.*` capabilities of
[roles](../auth/roles.md), and reading the records needs `collection.Uploads.read`; only the bytes
are public.

`PATCH` with `name` or `directory` renames or moves the row and its object, keeping a file's
extension; `?locale=` addresses the alt text's locale. The upload and replace routes accept
bodies up to `uploads.maxFileSize` and run without a handler deadline; `api.requestTimeout`,
Node's 5 minutes unless you set it, is the ceiling for a slow connection.

## Serving

`GET /uploads/<path>` streams the file with its type, an `ETag` from the file's hash so a fresh
`If-None-Match` answers `304`, `Cache-Control` from `uploads.cache`, and `Range` support for video
and audio. Every answer is `nosniff`; a type a browser would run as a document downloads as an
attachment, and an SVG renders under a sandboxing content security policy. With `publicURL` set,
records point at that origin and this route stays the origin behind it. Otherwise, when the
backend has its own `url`, records point there.

## In server code

The same operations are functions in `ohnejs/uploads`, for a route or a boot file of your own:

```ts
import { createFolder, deleteUpload, moveUpload, putUpload, updateUpload } from 'ohnejs/uploads';

const upload = await putUpload({ directory: 'imports', name: 'report.pdf', body });
await updateUpload(upload.UUID, { description: 'Quarterly report' }, { locale: 'de' });
await moveUpload(upload.UUID, { directory: 'archive/2026' });
await createFolder({ directory: 'archive', name: '2027' });
await deleteUpload(upload.UUID);
```

`body` is a web `ReadableStream`, as `useRequest().body` hands it to you. Every helper throws the
same errors the routes answer with, and each but `deleteUpload` answers the decorated record, an
`UploadRecord`. Changing `name` or `directory` through `query('Uploads')` directly moves no object;
use `moveUpload`.

`replaceUpload(uuid, body)` swaps a file's bytes and keeps its `UUID`, path, and type, so every
field that references it stays linked. Bytes that contradict the type are a `422`.

## The dashboard

The layer ships the Media page at `/media`, with folders, drag and drop uploads, a details popup
for alt text and the focal point, and a picker the [media fields](./fields.md) open. The sidebar
row replaces the `Uploads` collection's own row, so a viewer who may read `Uploads` sees Media
where the table would have been. To place it yourself, list `'Uploads'` in
[`dashboard.menu`](../dashboard/pages.md#the-sidebar) where you want the row.
