# Image variants

An uploaded image is served as it was uploaded. A variant of it - resized, cropped, re-encoded - is
rendered by an image service outside ohne, on demand, from a URL ohne signs. ohne stores no
variants and runs no image code: it builds the URL, the service does the work and caches the
result.

```ts
import { imageURL } from 'ohne/uploads';

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
import { defineConfig } from 'ohne';

export default defineConfig({
  layers: ['ohne', 'ohne/uploads'],
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
import { imageSrcSet, imageURL } from 'ohne/uploads';

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
import { imageVariantTokens } from 'ohne/uploads';

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

## The URL

```
{images.url}/{signature}/{transforms}/{path}
https://img.example.com/2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck/w_800,f_webp/photos/sunset.jpg
```

- `path` is the upload's path, `directory` and `name` joined: `photos/2024/sunset.jpg`. Every
  segment is a slug, so the path needs no encoding.
- `transforms` is a comma-separated list of `name_value` tokens, never empty.
- `signature` is the base64url HMAC-SHA256 of the string `{transforms}/{path}` under the secret,
  43 characters, no padding.

A service answers a URL only when the signature verifies, so nobody can ask it for a size ohne
did not sign. Signing happens in server code; the secret never reaches a browser.

## Transforms

| token | value                                                                                                                                  | default                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `w`   | target width in pixels, a positive integer                                                                                             |                                              |
| `h`   | target height in pixels, a positive integer                                                                                            |                                              |
| `fit` | `cover` fills the box and crops, `contain` letterboxes, `inside` shrinks to fit                                                        | `cover`                                      |
| `f`   | `webp`, `avif`, `jpeg`, `png`, or `auto`                                                                                               | the source format, `png` for a vector source |
| `q`   | encoding quality, `1` to `100`                                                                                                         | the service's own                            |
| `p`   | where a `cover` crop keeps its subject: `center`, `top`, `topRight`, `right`, `bottomRight`, `bottom`, `bottomLeft`, `left`, `topLeft` | `center`                                     |
| `fp`  | focal point of a `cover` crop as `fp_x_y`, each axis `0` to `1` with up to three decimals; replaces `p`                                |                                              |
| `dpr` | device pixel ratio the size is multiplied by, `1` to `4`, up to two decimals                                                           | `1`                                          |

The token string is canonical: tokens appear in the order of the table, a default is never
written, and a token appears at most once. Equal transforms therefore always produce one string
and one URL, which is what lets the service and every cache in front of it treat the URL as the
identity of a variant. Only ohne writes these strings, so a non-canonical spelling never exists.

`imageURL` fills `fp` from the upload's own focal point when the fit is `cover` and the transforms
name no position, so a crop keeps the subject an editor marked in the dashboard. `contain` and
`inside` never crop, so their URLs carry no focal point and stay the same when an editor moves it.

## Signing

```
signature = base64url(HMAC-SHA256(secret, transforms + '/' + path))
```

Plain HMAC over the raw string, no derived keys, so any language implements it in three lines.
Two vectors to test an implementation against:

| secret    | transforms               | path                | signature                                     |
| --------- | ------------------------ | ------------------- | --------------------------------------------- |
| `secret`  | `w_800,f_webp`           | `photos/sunset.jpg` | `2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck` |
| `another` | `w_320,h_320,fit_inside` | `photos/sunset.jpg` | `s9YxH4SXC6gGsS97gs_WMTAcNvgSnZe7zUBB__NeUMs` |

`IMAGES_SECRET` may list several secrets, comma-separated. ohne signs with the first; a service
accepts a URL signed by any of them. To rotate, add the new secret first on the service, then in
front on ohne, then drop the old one from the service once every page has re-rendered. No URL
carries an expiry: variant URLs live in pages and in caches, and a leaked URL grants nothing
beyond the one variant it names.

## What a service does

1. Split the path into three parts: the first segment is the signature, the second the transforms,
   the rest the source path. Answer `404` to fewer than three segments. Ignore the query string,
   for routing and for the cache key, so nobody forces a re-render by varying it.
2. Verify the signature over the raw `{transforms}/{path}` string before parsing anything. Answer
   `403` when it does not verify. An unsigned service, meant for a local machine, skips this step.
3. Parse the transforms. Answer `400` to an empty segment, an unknown token, an out-of-range value,
   a duplicate, or both `p` and `fp`.
4. Fetch the source at `{sourceURL}/{path}`, where `sourceURL` is the service's own setting,
   normally the app's `/uploads` origin. Answer `404` when the origin does and `502` when it is
   unreachable, both with `Cache-Control: no-store`. Revalidate a fetched source with
   `If-None-Match` on a short interval, a minute say, and drop its variants when the `ETag`
   changes, so a replaced file propagates. When the origin sends no `ETag`, hash the bytes and let
   the hash stand in for it.
5. Render. Multiply `w` and `h` by `dpr` before fitting. At `dpr` 1 never scale the source up:
   `inside` and `contain` do not enlarge, and `cover` shrinks the box at its own ratio until the
   source fills it. Pad `contain` to the full box with transparency, white for `jpeg`; padding is
   not enlargement. Position by `p` or `fp` only for `cover`; `contain` and `inside` do not crop.
   Apply the EXIF orientation, then strip the metadata. Encode in `f` at `q`; on `png`, `q` is
   palette quantization. Without `f`, keep the source format, and encode a vector source as `png`.
   For `f_auto`, pick `avif` when `Accept` contains `image/avif`, else `webp` when it contains
   `image/webp`, else the source format - `image/*` alone means the source format - and add
   `Vary: Accept` to the answer.
6. Answer with the rendered bytes, `Content-Type`, and a long `Cache-Control: public, max-age`, and
   keep the result cached by URL for the next request. With `f_auto` the negotiated format joins
   the cache key, since the URL alone no longer identifies the bytes.

`f_auto` is only worth using behind a CDN that normalizes `Accept`; otherwise every browser's
`Accept` string is a separate cache entry. `imageSrcSet` writes explicit formats for a `<picture>`
instead.

An SVG has no pixels of its own, so the `dpr` 1 cap does not apply to it. Rasterize it at the
density the output needs, then fit; scaling up a low-density raster instead blurs every edge. An
SVG without `width`, `height`, or `viewBox` may render from its ink bounds, depending on the
rasterizer, so give an uploaded SVG a `viewBox`. Its thumbnail is a WebP raster like any other.

## Responsive images

`imageSrcSet` builds a `srcset` from a list of entries, each a variant name or a transforms object,
every one a signed URL with the entry's width as its `w` descriptor:

```ts
import { imageSrcSet, imageURL } from 'ohne/uploads';

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

## The reference service

ohne ships the protocol; the reference implementation, `ohne-images`, runs on Node and sharp in its
own package, since sharp is a native dependency and ohne has none. Any implementation that follows the six
steps above works, including one behind a CDN or on an edge runtime.
