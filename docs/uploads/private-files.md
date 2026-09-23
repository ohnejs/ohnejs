# Private files

A private file opens only through a link that expires, or for a signed-in reader who may read
`Uploads`. The feature runs on `UPLOADS_SECRET`: without it every file is public.

Mark a file or folder private in the dashboard, or in server code:

```ts
import { updateUpload } from 'ohnejs/uploads';

await updateUpload(upload.UUID, { private: true });
```

With `UPLOADS_SECRET` set, every read of it now carries a signed link that expires.

## Marking files private

In the dashboard, use the `Private` switch in a file's details, or `Make private` on a tile or a
selection. Every file starts public, including the ones you uploaded before.

A folder locks everything inside it:

- Toggling a folder rewrites its whole subtree.
- A file uploaded into a private folder, or a folder created in one, is private.
- Moving into a private folder makes the moved row private, a folder with its subtree. Moving out,
  or renaming in place, changes nothing.

## What a read carries

A private file's [decorations](./uploads.md#the-collection) change:

```ts
upload.url; // -> '/uploads/press/launch.jpg?e=1700000000000&s=...'
upload.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp,e_1700000000000/press/launch.jpg'
upload.expires; // -> 1700000000000
```

- `url` is always the API route, never `publicURL` or the backend's own. `e` is the expiry in
  epoch milliseconds and `s` its signature.
- `variants` carry the same expiry as their last [transform](./image-service.md#transforms), and
  need `IMAGES_SECRET` too, since an unsigned service could not guard the original.
- `expires` says when both stop working.
- A read whose `select` leaves out `private` decorates every file as private, so select it too.

## The secret

`UPLOADS_SECRET` signs every link:

```sh
UPLOADS_SECRET=a-long-random-value
```

- It may list several secrets, comma-separated. The first signs and any verifies, so it
  [rotates](./image-variants.md#rotating-the-secret) like `IMAGES_SECRET`.
- Without it the layer keeps no private files at all. Every file is served to anyone, a stored
  `private` is ignored, `PATCH` drops it, the link route answers `404`, and the dashboard hides
  the switch, the badges, and the bulk actions. ohne warns at boot while a private row exists.
- The column stays, so nothing is lost: set the secret and the same rows are private again.

## How long a link lives

`uploads.privateMaxAge` sets the window, as a `parseDuration` value:

```ts
uploads: { privateMaxAge: '1h' },
```

- A read mints links that expire at the end of the window after the one holding now, so a link
  lives between one and two windows.
- Every read inside one window mints the same URLs, so a browser cache keeps working.

## Who can open the bytes

`GET /uploads/<path>` streams a private file only when:

- the URL carries a valid `s` for an `e` that has not passed, or
- the caller is signed in, holds `collection.Uploads.read`, and the read's
  [`access`](../api/collections.md#access) scope reaches the row.

Anyone else gets the same `404` as an unknown path.

To keep some files behind a role, grant it a
[custom capability](../auth/roles.md#custom-capabilities) and scope the read in
[your own `collections/Uploads.ts`](./uploads.md#the-collection):

```ts
api: {
  read: {
    access: async () =>
      userCan(await requireUser(), 'media.private') || { where: { private: false } },
  },
},
```

A caller outside the scope does not see the row, cannot fetch its bytes, and gets `null` where a
[media field](./fields.md#reading) references it.

## Temporary links

A link for someone who is not signed in lasts exactly as long as you say:

```ts
import { temporaryUploadURL } from 'ohnejs/uploads';

temporaryUploadURL(upload, '7d');
// -> { url: '/uploads/press/launch.jpg?e=1700604800000&s=...', expires: 1700604800000 }
```

- `maxAge` is a `parseDuration` value counted from now, not aligned to a window.
- `GET /uploads/[uuid]/link?maxAge=7d` answers the same `{ url, expires }` to a caller who may read
  `Uploads`. `maxAge` defaults to `privateMaxAge`. A public file answers its plain `url` with
  `expires: null`.
- The details popup offers the same as `Copy temporary link`.
- Without `UPLOADS_SECRET`, `temporaryUploadURL` throws.

## Storage and the image service

A [storage backend](./uploads.md#storage) whose objects are readable without the API can lock them
too, with `setPrivate`. [`@ohnejs/uploads-s3`](./uploads.md#storing-files-in-s3) tags a private
object, and its [README](https://github.com/ohnejs/uploads-s3#private-files) has the bucket policy
that refuses it.

An [image service](./image-service.md#what-a-service-does) fetches a private original through a
signed link of its own, made with `IMAGES_SOURCE_SECRET`, one of the values in `UPLOADS_SECRET`.
Only a variant URL that expires gets one, so a link from before the file went private stops working.
