# Media fields

Media field types let your own collections reference uploads:
[`image`](../database/field-types.md#image) and [`file`](../database/field-types.md#file) hold one
upload, and [`images`](../database/field-types.md#images) and
[`files`](../database/field-types.md#files) hold an ordered list. Each stores the upload's `UUID`,
exactly as a [relation](../database/collections.md#relations) does, and checks the referenced file
against the limits you declare.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    cover: field('image', { maxSize: '5mb', minWidth: 1200 }),
    attachments: field('files', { types: ['document'], max: 10 }),
  },
});
```

In the dashboard, each one shows a picker for the media library and a direct upload button. A file
that the field cannot accept is greyed out, with the reason.

## Options

`image` and `images` accept only images and add pixel limits. `file` and `files` accept anything
unless `types` narrows them.

- `types` - the media types the field accepts. Defaults to `['image']` on the image fields, and to
  any file on the others.
- `minSize`, `maxSize` - file size limits, as `parseBytes` values like `'5mb'`.
- `minWidth`, `maxWidth`, `minHeight`, `maxHeight` - pixel limits, image fields only.
- `onDelete` - what happens when the upload is deleted, as for
  [relations](../database/collections.md#relations): `setNull` by default on `image` and `file`,
  and `cascade` on `images` and `files`.
- `allowEmpty`, `min`, `max` - list fields only. They limit how many links a
  [written list](../database/writing.md#input) holds.

### Types

A `types` entry is an exact media type (`image/png`), a top-level wildcard (`image/*`), or a
category name: `image`, `video`, `audio`, `document`, `archive`, `font`, `text`, `code`. A
category groups the media types a person would expect under it, so `['document']` takes PDFs and
office formats without listing them. `uploads.types` in [config](./uploads.md#configuration) uses
the same grammar.

## Validation

A write checks each referenced upload against the field's options, in one read. The upload must be
a file, an image for the image fields, and within `types`, the size limits, and the pixel limits.
An image whose `width` and `height` could not be read passes the pixel limits.

A failure is reported at the field, or at `attachments[2]` for the third item of a list, with a
[message](../i18n/messages.md#validation-messages) such as `The file must be at most 5 MB`. A `UUID`
that belongs to no upload fails like any other
[broken reference](../database/writing.md#uniqueness-and-references).

## Reading

[Populate](../database/reading.md#populating-relations) the field to get the upload's record,
decorated with `url`, with `variants` when an [image service](./image-variants.md) is configured,
and with `expires` for a [private file](./private-files.md):

```ts
const post = await query('Posts').populate('cover').where('UUID', id).findFirst();

post.cover.url; // -> '/uploads/photos/sunset.jpg'
post.cover.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
```

A private file's `url` and `variants` stop working at `expires`, so render them per request rather
than storing them.

Over the [collections API](../api/collections.md), a media field
[populates](../api/url-queries.md#populating-relations) only for a caller who
[may read `Uploads`](./uploads.md#the-collection). Anyone else, including a visitor who is not
signed in, gets `null` for `image` and `file` and an empty list for `images` and `files`. To serve
media fields to everyone, make that read public. A public read also hands out a private file's
expiring links, unless its [`access`](./private-files.md#who-can-open-the-bytes) scope hides
private rows.

For a page of your own, [`imageURL`](./image-variants.md#named-variants) builds a variant URL and
[`imageSrcSet`](./image-variants.md#responsive-images) builds a `srcset`. Without a service, both
fall back to the original's URL, so a template needs no special case.
