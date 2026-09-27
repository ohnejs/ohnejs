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

The layer ships the Media page at `/media`, with folders, drag and drop uploads,
[uploads from a URL](./from-a-url.md), a details popup for alt text and the focal point, and
a picker that the [media fields](./fields.md) open.

The sidebar row replaces the `Uploads` collection's own row, so a viewer who is allowed to read
`Uploads` sees Media instead of the table. To place it yourself, list `'Uploads'` in
[`dashboard.menu`](../dashboard/pages.md#the-sidebar) where you want the row.

## The collection

`Uploads` holds one row per file and per folder:

- `directory` - the parent path, with no leading slash and `''` at the root. A write that would
  make any path longer than 768 characters is a `422`.
- `name` - the file or folder name. The `directory` and `name` pair is unique, as on a filesystem,
  and every segment is a slug of at most 255 characters.
- `description` - a file's alt text, one per
  [content locale](../database/translations.md#marking-fields).
- `private` - whether only a [signed-in reader with access, or a temporary link](./private-files.md)
  opens the bytes.
- `type`, `size`, `hash`, `width`, `height`, `focalX`, `focalY`, `author`, and `uploadedAt`
  describe the file.

Every read is decorated with extra fields:

- `path` joins `directory` and `name`.
- `url` is where a file's bytes are served from.
- `variants` holds one signed URL per [named variant](./image-variants.md#named-variants), when an
  image service is configured.
- `expires` says when a [private file's](./private-files.md) `url` and `variants` stop working.

A folder is decorated with `path` only:

```ts
const upload = await query('Uploads').where('UUID', uuid).findFirst();

upload.path;
// -> 'photos/2024/sunset.jpg'

upload.url;
// -> '/uploads/photos/2024/sunset.jpg'

upload.variants.thumbnail;
// -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/2024/sunset.jpg'
```

Only `read` is exposed over the [collections API](../api/collections.md#exposure), and it is
guarded: the caller needs the `collection.Uploads.read`
[capability](../auth/roles.md#the-collections-api-guard). Every write goes through the
[routes](#uploading-over-http) or the [helpers](#in-server-code), which are the only code that moves
bytes.

Attaching an upload to a [media field](./fields.md) through the collections API needs the same
read as fetching it: an upload the caller cannot read fails with `invalidReference`.

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

Beside `Uploads`, the layer keeps its bookkeeping in `UploadsJournal` and `UploadsSessions`. It
needs all of them, so [disabling](../project/config.md#disabling) one stops the boot.

## Uploading over HTTP

The request body is the file. One file per request, metadata in the query:

```
POST   /uploads?directory=photos&name=Sunset.JPG   the body is the file, answers 201 with the record
POST   /uploads/fetch                               { "url": "https://...", "directory": "photos" }
POST   /uploads/folders                             { "directory": "photos", "name": "2024" }
PATCH  /uploads/[uuid]                              rename, move, or edit a file
POST   /uploads/[uuid]/replace                      the body replaces the file's bytes
DELETE /uploads/[uuid]                              a folder takes everything inside it
POST   /uploads/move                                { "uuids": [...], "directory": "archive" }
POST   /uploads/private                             { "uuids": [...], "private": true }
POST   /uploads/delete                              { "uuids": [...] }
POST   /uploads/[uuid]/link                         { "maxAge"?: "7d" }   a link to a private file
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

`POST /uploads/fetch` stores a file [from a URL](./from-a-url.md) the same way.

The bulk routes take up to 1000 `uuids` and are all or nothing: if one row fails, nothing changes,
and the answer is the error that row would get on its own.

Writes need the `collection.Uploads.*` capabilities of
[roles](../auth/roles.md#the-collections-api-guard) and reach only the rows the read's
[`access`](./private-files.md#who-can-open-the-bytes) scope shows. The bytes are public unless the
file is [private](./private-files.md).

`PATCH` takes any of `name`, `directory`, `description`, `focalX`, `focalY`, and `private`. With
`name` or `directory` it renames or moves the row and its object. A file's extension names its
type, so a name with another extension is a `422`. `?locale=` selects the alt text's locale.

The upload and replace routes accept bodies up to `uploads.maxFileSize` and run with no handler
timeout. An upload may take up to [`api.requestTimeout`](../project/config.md#the-api-server).
Unless you set it, that is Node's default of 5 minutes. A file that needs longer can go up in
[resumable chunks](./resumable.md), each with a timeout of its own.

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
  replaceUpload,
  setUploadsPrivate,
  updateUpload,
} from 'ohnejs/uploads';

const upload = await putUpload({ directory: 'imports', name: 'report.pdf', body });
await updateUpload(upload.UUID, { description: 'Quarterly report' }, { locale: 'de' });
await replaceUpload(upload.UUID, newBody);
await moveUpload(upload.UUID, { directory: 'archive/2026' });
const folder = await createFolder({ directory: 'archive', name: '2027' });
await moveUploads([upload.UUID], folder.path);
await setUploadsPrivate([upload.UUID], true);
await deleteUpload(upload.UUID);
await deleteUploads([folder.UUID]);
```

- `body` is a web `ReadableStream`, which is what [`useRequest().body`](../api/request.md#the-body)
  gives you.
- Every helper throws the same errors the routes answer with.
- Every helper except the deletes returns the decorated record, an `UploadRecord`, or a list of them.
- `moveUploads`, `setUploadsPrivate`, and `deleteUploads` are
  [all or nothing](#uploading-over-http), like the bulk routes.
- `replaceUpload` keeps the `UUID`, path, and type, so every field that references the file stays
  linked.

Changing `name` or `directory` directly through `query('Uploads')` does not move the object, so use
`moveUpload`.

## Serving

`GET /uploads/<path>` streams the file with:

- its type,
- an `ETag` from the file's hash, so a fresh `If-None-Match` answers
  [`304`](../api/response.md#caching),
- `Cache-Control` from `uploads.cache`, `private` for a private file,
- `Range` support for video and audio, honoring `If-Range`.

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
    maxSVGSize: '2mb',
    chunkSize: '8mb',
    types: '*',
    cache: { noCache: true },
    privateMaxAge: '1h',
    sessionMaxAge: '1d',
    images: {
      variants: {
        thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' },
      },
    },
    fetch: { allow: [], timeout: '2m' },
  },
});
```

Sizes take bytes or a string like `'8mb'`. Durations take milliseconds or a string like `'1h'`.

- `storage` - the [backend](./storage.md), by name. The layer ships `fs`, and
  [`@ohnejs/uploads-s3`](./storage.md#storing-files-in-s3) adds `s3`.
- `url` - where the backend keeps the files: a directory for `fs`, a bucket and prefix for
  [`s3`](./storage.md#storing-files-in-s3). `UPLOADS_URL` overrides it.
- `maxFileSize` - the largest file that can be uploaded.
- `maxSVGSize` - the largest SVG that can be uploaded. The server answers nothing else while it
  sanitizes one, so a higher cap lets a single upload stall it for longer.
- `chunkSize` - the size of every chunk of a [resumable upload](./resumable.md) but the last,
  `64kb` or more.
- `types` - the media types that may be uploaded: `'*'`, or a list of exact types, `image/*`
  wildcards, and category names such as `document`, in the
  [media fields grammar](./fields.md#types).
- `cache` - the [`Cache-Control`](../api/response.md#caching) directives every served file carries.
  The default revalidates on every use, so a renamed or replaced file is never stale.
- `publicURL` - an origin that serves the stored files by their path, such as a CDN in front of
  the storage. Without it, records point where [serving](#serving) describes.
- `privateMaxAge` - how long a [private file's](./private-files.md) links stay valid.
- `sessionMaxAge` - how long a [resumable upload](./resumable.md) has from its first request to
  completion.
- `images` - the [image service](./image-variants.md) that renders resized variants, and the named
  variants every image read carries. `url` has no default, and without it every image URL points at
  the original.
- `fetch` - the `allow` list and the `timeout` of [uploads from a URL](./from-a-url.md).

## Where files live

A file is stored under its path, `photos/2024/sunset.jpg`, and a folder is a prefix. The `fs`
backend keeps that layout under `uploads.url`, `.uploads` by default. [Storage](./storage.md) covers
S3 and a backend of your own.
