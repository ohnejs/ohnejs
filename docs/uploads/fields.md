# Media fields

Four field types reference uploads from your own collections: `image` and `file` hold one, `images`
and `files` an ordered list. Each stores the upload's `UUID`, exactly as a
[relation](../database/collections.md#relations) does, and checks the referenced file against
the bounds you declare.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohne';

export default defineCollection({
  fields: {
    title: field('text'),
    cover: field('image', { maxSize: '5mb', minWidth: 1200 }),
    attachments: field('files', { types: ['document'], max: 10 }),
  },
});
```

In the dashboard each renders a picker over the media library and a direct upload button, and an
ineligible file is greyed out with the reason.

## Options

`image` and `images` accept only images and add pixel bounds; `file` and `files` accept anything
unless `types` narrows them.

- `types` - the media types the field accepts. Defaults to `['image']` on the image fields, to
  any file on the others.
- `minSize`, `maxSize` - byte bounds, as `parseBytes` values like `'5mb'`.
- `minWidth`, `maxWidth`, `minHeight`, `maxHeight` - pixel bounds, image fields only.
- `onDelete` - what happens when the upload is deleted. On `image` and `file`: `setNull` (the
  default) clears the reference, `cascade` deletes the referencing row, `restrict` blocks the
  delete. On `images` and `files`: `cascade` (the default) removes the link, `restrict` blocks.
- `allowEmpty`, `min`, `max` - list fields only, bounding how many links a written list holds.

### Types

A `types` entry is an exact media type (`image/png`), a top-level wildcard (`image/*`), or a
category name: `image`, `video`, `audio`, `document`, `archive`, `font`, `text`, `code`. A
category groups the media types a person would expect under it, so `['document']` takes PDFs and
office formats without listing them. The same grammar bounds `uploads.types` in
[config](./uploads.md#configuration).

## Validation

A write checks every referenced row in one read: it must be a file, an image for the image fields,
within `types`, within the size bounds, and within the pixel bounds. A failure reports at the
field, or at `field[2]` for the third item of a list, with a message such as
`The file must be at most 5 MB`. A `UUID` that names no upload fails as any broken reference does.

## Reading

Populate the field to get the upload's record, decorated with `url` and, when an
[image service](./images.md) is configured, `variants`:

```ts
const post = await query('Posts').populate('cover').where('UUID', id).findFirst();

post.cover.url; // -> '/uploads/photos/sunset.jpg'
post.cover.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
```

For a page of your own, build a variant with `imageURL` or a `srcset` with `imageSrcSet`, from a
[named variant](./images.md#named-variants) or ad hoc transforms:

```ts
import { imageSrcSet, imageURL } from 'ohne/uploads';

const src = imageURL(post.cover, 'thumbnail');
const srcset = imageSrcSet(post.cover, [
  { width: 600, format: 'webp' },
  { width: 1200, format: 'webp' },
  { width: 2400, format: 'webp' },
]);
```

Both fall back to the original's URL without a service, so a template needs no branch.
