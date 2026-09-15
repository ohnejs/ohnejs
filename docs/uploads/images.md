# Image variants

An uploaded image is served as it was uploaded. A variant of it - resized, cropped, re-encoded - is
rendered by an image service outside ohne, on demand, from a URL ohne signs. ohne stores no
variants and runs no image code: it builds the URL, the service does the work and caches the
result.

```ts
import { imageURL } from 'ohnejs/uploads';

imageURL(upload, { width: 800, format: 'webp' });
// -> 'https://img.example.com/2Obrt.../w_800,f_webp/photos/2024/sunset.jpg'
```

Set `uploads.images.url` in [config](../project/config.md) to the service origin and `IMAGES_SECRET`
in the environment to the secret you share with it. Without a URL, `imageURL` returns the original
file's URL, so a page renders the same either way. Without a secret, the URL carries `unsigned` where
the signature would go: a service started with `--unsigned` renders it, a signing one refuses it with
`403`, and ohne warns at boot. That is for your own machine, never for a service others can reach.

## Named variants

Most pages need the same few sizes everywhere. Name them once under `uploads.images.variants`,
each a transforms object:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs', 'ohnejs/uploads'],
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

A name is a camelCase identifier. The layer ships one, `thumbnail`, as
`{ width: 320, height: 320, fit: 'inside', format: 'webp' }`: it fits an image inside a 320 pixel
box for the dashboard grid without cropping, so only a square source renders square. Names union
across layers and a redefinition replaces the whole preset, so `thumbnail: { width: 200 }` does not
keep the shipped height. A name that is not an identifier, or a preset with no transforms, fails at
boot.

Every read of an image carries `variants`, one signed URL per name, when a service is configured:

```ts
const upload = await query('Uploads').where('UUID', uuid).findFirst();

upload.variants.thumbnail; // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
upload.variants.card; // -> 'https://img.example.com/.../w_640,h_360,f_webp/photos/sunset.jpg'
```

That is the whole vocabulary a browser sees. Signing stays in server code, and a page that only
ever renders named variants never asks the service for a size you did not choose. Without a
service the key is absent, and a file that is not an image never carries it. The dashboard's
details popup lists them under Variants.

In server code, pass the name instead of a transforms object:

```ts
import { imageSrcSet, imageURL } from 'ohnejs/uploads';

imageURL(upload, 'thumbnail'); // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
imageSrcSet(upload, ['card', 'cardWide']); // -> 'https://img.example.com/.../w_640,h_360,f_webp/photos/sunset.jpg 640w, ...'
imageURL(upload); // -> '/uploads/photos/sunset.jpg'
```

Codegen types the names. Once `ohne prepare` or `ohne dev` has run, `ImageVariantName` is the
union of every configured name, your own `ohne.config.ts` entries included, so a name autocompletes
in `imageURL` and `imageSrcSet` and a typo fails to type-check. Until then any string is accepted,
and at runtime an unknown name throws, so the mistake surfaces in server code rather than as a
broken image.

A service can refuse everything but your variants. `imageVariantTokens` answers the canonical token
string of every name:

```ts
import { imageVariantTokens } from 'ohnejs/uploads';

imageVariantTokens();
// -> { thumbnail: 'w_320,h_320,fit_inside,f_webp', card: 'w_640,h_360,f_webp', cardWide: 'w_1280,h_720,f_webp' }
```

The reference service reads them from `IMAGES_VARIANTS`, semicolon-separated, and answers `403` to a
URL whose signature verifies but whose tokens are not listed. The match ignores `fp` and `p`, which
carry the upload's focal point rather than a size. With the list set, a leaked secret or a careless
template cannot ask the service for a size you did not choose. The focal point stays free, so the
list bounds the sizes a service renders, not the number of entries in its cache.

```sh
IMAGES_VARIANTS='w_320,h_320,fit_inside,f_webp;w_640,h_360,f_webp;w_1280,h_720,f_webp'
```

## Cropping

`fit` decides how a variant fills its box. `cover`, the default, fills the box and crops; `contain`
letterboxes; `inside` shrinks to fit. A `cover` crop keeps its subject where `position` or
`focalPoint` puts it.

When the fit is `cover` and the transforms name neither, `imageURL` fills in the upload's own focal
point, so a crop keeps the subject an editor marked in the dashboard. `contain` and `inside` never
crop, so their URLs carry no focal point and stay the same when an editor moves it.

## Responsive images

`imageSrcSet` builds a `srcset` from a list of entries, each a variant name or a transforms object,
every one a signed URL with the entry's width as its `w` descriptor:

```ts
import { imageSrcSet, imageURL } from 'ohnejs/uploads';

const src = imageURL(upload, 'card');
const srcset = imageSrcSet(upload, ['card', 'cardWide']);
// -> 'https://img.example.com/.../w_640,h_360,f_webp/photos/sunset.jpg 640w, https://img.example.com/.../w_1280,h_720,f_webp/photos/sunset.jpg 1280w'
```

Pair it with `sizes` on the `<img>`, and the browser picks the width it needs. An entry without a
width has no descriptor to write and throws. Ad hoc entries work the same way:

```ts
imageSrcSet(upload, [
  { width: 400, format: 'webp' },
  { width: 800, format: 'webp' },
]);
// -> 'https://img.example.com/.../w_400,f_webp/photos/sunset.jpg 400w, https://img.example.com/.../w_800,f_webp/photos/sunset.jpg 800w'
```

`format: 'auto'` lets the service pick the format from the browser's `Accept` header. It is only
worth using behind a CDN that normalizes `Accept`; otherwise every browser's `Accept` string is a
separate cache entry. `imageSrcSet` writes explicit formats for a `<picture>` instead.

## Rotating the secret

`IMAGES_SECRET` may list several secrets, comma-separated. ohne signs with the first; a service
accepts a URL signed by any of them. To rotate, add the new secret first on the service, then in
front on ohne, then drop the old one from the service once every page has re-rendered.

## The reference service

ohne ships the protocol; the reference implementation, `ohne-images`, runs on Node and sharp in its
own package, since sharp is a native dependency and ohne has none. Any implementation that follows
[the image service protocol](./image-service.md) works, including one behind a CDN or on an edge
runtime.
