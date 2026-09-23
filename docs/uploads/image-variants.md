# Image variants

An uploaded image is served as it was uploaded. A variant is a resized, cropped, or re-encoded copy.
An image service outside ohne renders it on demand, from a URL that ohne
[signs](./image-service.md#signing). ohne stores no variants and runs no image code: it builds the
URL, and the service does the work and caches the result.

```ts
import { imageURL } from 'ohnejs/uploads';

imageURL(upload, { width: 800, format: 'webp' });
// -> 'https://img.example.com/2Obrt.../w_800,f_webp/photos/2024/sunset.jpg'
```

## Connecting a service

Set `uploads.images.url` in [the uploads config](./uploads.md#configuration) to the service origin,
and `IMAGES_SECRET` in the environment to the secret you share with it:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: {
    images: { url: 'https://img.example.com' },
  },
});
```

```sh
IMAGES_SECRET=a-long-random-value
```

Without a URL, `imageURL` returns the original file's URL, so a page renders the same either way.

Without a secret, the URL carries `unsigned` where the signature would go:

- A service started with `--unsigned` renders it.
- A signing service refuses it with `403`.
- ohne warns at boot.

That is for your own machine, never for a service others can reach.

## Named variants

Most pages need the same few sizes everywhere. Name them once under `uploads.images.variants`.
Each one is a [transforms](./image-service.md#transforms) object:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: {
    images: {
      url: 'https://img.example.com',
      variants: {
        card: { width: 640, height: 360, format: 'webp' },
        cardWide: { width: 1280, height: 720, format: 'webp' },
      },
    },
  },
});
```

- A name is a camelCase identifier.
- The layer ships `thumbnail` as `{ width: 320, height: 320, fit: 'inside', format: 'webp' }`. It
  fits an image inside a 320 pixel box for the dashboard grid without cropping, so the result is
  square only when the original image is square.
- Names from every layer are combined. Defining a name again replaces the whole preset, so
  `thumbnail: { width: 200 }` does not keep the shipped height.
- A name that is not an identifier, or a preset with no transforms, fails at boot.

Every [read of an image](./uploads.md#the-collection) carries `variants`, one signed URL per name,
when a service is configured:

```ts
const upload = await query('Uploads').where('UUID', uuid).findFirst();

upload.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
upload.variants.card; // -> 'https://img.example.com/.../w_640,h_360,f_webp/photos/sunset.jpg'
```

Without a service, or for a file that is not an image, `variants` is absent. A
[private image's](./private-files.md) variants expire with its `url`. Signing stays in server
code, and the dashboard's [details popup](./uploads.md#the-dashboard) lists the variants under
Variants.

In server code, pass the name instead of a transforms object:

```ts
import { imageURL } from 'ohnejs/uploads';

imageURL(upload, 'thumbnail'); // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
imageURL(upload); // -> '/uploads/photos/sunset.jpg'
```

After [`ohne prepare`](../project/cli.md#ohne-prepare) or `ohne dev`, names autocomplete in
`imageURL` and `imageSrcSet`, and a typo fails to type-check. `ImageVariantName` is the union of
every configured name, including the ones in your own `ohne.config.ts`. Before codegen runs, any
string is accepted. At runtime an unknown name throws, so you see the mistake in server code and
not as a broken image.

## Cropping

`fit` decides how a variant fills its box:

- `cover`, the default, fills the box and crops.
- `contain` letterboxes: it fits the whole image and pads the rest of the box.
- `inside` shrinks to fit.

With `cover`, `position` or `focalPoint` decides which part of the image the crop keeps. When the
fit is `cover` and the transforms set neither, `imageURL` adds the upload's own focal point, so a
crop keeps the subject an editor marked in the dashboard.

`contain` and `inside` never crop, so their URLs carry no focal point and stay the same when an
editor moves it.

## Responsive images

`imageSrcSet` builds a `srcset` from a list of entries. Each entry is a variant name or a
transforms object, and becomes a signed URL with the entry's width as its `w` descriptor:

```ts
import { imageSrcSet, imageURL } from 'ohnejs/uploads';

const src = imageURL(upload, 'card');
const srcset = imageSrcSet(upload, ['card', 'cardWide']);
// -> 'https://img.example.com/.../w_640,h_360,f_webp/photos/sunset.jpg 640w, https://img.example.com/.../w_1280,h_720,f_webp/photos/sunset.jpg 1280w'
```

Use it with `sizes` on the `<img>`, and the browser picks the width it needs. An entry without a
width throws, because there is no descriptor to write. Transforms objects work the same way:

```ts
imageSrcSet(upload, [
  { width: 400, format: 'webp' },
  { width: 800, format: 'webp' },
]);
// -> 'https://img.example.com/.../w_400,f_webp/photos/sunset.jpg 400w, https://img.example.com/.../w_800,f_webp/photos/sunset.jpg 800w'
```

[`format: 'auto'`](./image-service.md#what-a-service-does) lets the service pick the format from the
browser's `Accept` header. It is only useful behind a CDN that normalizes `Accept`. Without one,
every browser's `Accept` string is a separate cache entry. `imageSrcSet` writes explicit formats
for a `<picture>` instead.

## Rotating the secret

`IMAGES_SECRET` may list several secrets, comma-separated. ohne signs with the first, and a service
accepts a URL signed by any of them. To rotate:

1. Add the new secret on the service.
2. On ohne, put it first in the list.
3. Once every page has re-rendered, remove the old one from the service.

## The reference service

ohne ships the protocol. The reference implementation,
[`@ohnejs/images`](https://github.com/ohnejs/images), runs on Node and sharp. It lives in its own
package, because sharp is a native dependency and ohne has none. Any implementation that follows
[the image service protocol](./image-service.md) works, including one behind a CDN or on an edge
runtime.

## Allowing only your variants

A service can refuse everything except your variants. `imageVariantTokens` returns the canonical
token string of every name:

```ts
import { imageVariantTokens } from 'ohnejs/uploads';

imageVariantTokens();
// -> { thumbnail: 'w_320,h_320,fit_inside,f_webp', card: 'w_640,h_360,f_webp', cardWide: 'w_1280,h_720,f_webp' }
```

The [reference service](#the-reference-service) reads them from `IMAGES_VARIANTS`,
semicolon-separated:

```sh
IMAGES_VARIANTS='w_320,h_320,fit_inside,f_webp;w_640,h_360,f_webp;w_1280,h_720,f_webp'
```

- A URL with a valid signature gets a `403` when its tokens are not in the list.
- The match ignores `fp`, `p`, and `e`, which carry where a crop keeps its subject and a
  [private file's](./private-files.md) expiry rather than a size.

With the list set, a leaked secret or a careless template cannot ask the service for a size you did
not choose. The focal point is not restricted, so the list limits the sizes a service renders, not
the number of entries in its cache.
