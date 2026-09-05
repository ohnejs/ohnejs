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
in the environment to the secret you share with it. Without either, `imageURL` returns the
original file's URL, so a page renders the same either way.

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

| token | value                                                                                                         | default           |
| ----- | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| `w`   | target width in pixels, a positive integer                                                                    |                   |
| `h`   | target height in pixels, a positive integer                                                                   |                   |
| `fit` | `cover` fills the box and crops, `contain` letterboxes, `inside` shrinks to fit                               | `cover`           |
| `f`   | `webp`, `avif`, `jpeg`, `png`, or `auto`                                                                      | the source format |
| `q`   | encoding quality, `1` to `100`                                                                                | the service's own |
| `p`   | crop position: `center`, `top`, `topRight`, `right`, `bottomRight`, `bottom`, `bottomLeft`, `left`, `topLeft` | `center`          |
| `fp`  | focal point as `fp_x_y`, each axis `0` to `1` with up to three decimals; replaces `p`                         |                   |
| `dpr` | device pixel ratio the size is multiplied by, `1` to `4`, up to two decimals                                  | `1`               |

The token string is canonical: tokens appear in the order of the table, a default is never
written, and a token appears at most once. Equal transforms therefore always produce one string
and one URL, which is what lets the service and every cache in front of it treat the URL as the
identity of a variant. Only ohne writes these strings, so a non-canonical spelling never exists.

`imageURL` fills `fp` from the upload's own focal point when the transforms name no position, so a
crop keeps the subject an editor marked in the dashboard.

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

1. Split the path into the three parts. The first segment is the signature, the second the
   transforms, the rest the source path.
2. Verify the signature over the raw `{transforms}/{path}` string before parsing anything. A URL
   that does not verify is a `403`.
3. Parse the transforms. An unknown token, an out-of-range value, a duplicate, or both `p` and `fp`
   is a `400`.
4. Fetch the source at `{sourceURL}/{path}`, where `sourceURL` is the service's own setting,
   normally the app's `/uploads` origin. Send `If-None-Match` with the stored `ETag` when the source
   was fetched before, on a short interval, so a replaced file propagates.
5. Render: resize into the box by `fit`, crop around `fp` or `p`, encode in `f` at `q`, scale by
   `dpr`. `f_auto` picks `avif`, then `webp`, then the source format from the request's `Accept`
   header and adds `Vary: Accept` to the answer.
6. Answer with the rendered bytes, `Content-Type`, and a long `Cache-Control: public, max-age`,
   and keep the result cached by URL for the next request.

`f_auto` is only worth using behind a CDN that normalizes `Accept`; otherwise every browser's
`Accept` string is a separate cache entry. `imageSrcSet` writes explicit formats for a `<picture>`
instead.

## Responsive images

`imageSrcSet` builds a `srcset` from a list of widths, every entry a signed URL:

```ts
import { imageSrcSet, imageURL } from 'ohne/uploads';

const src = imageURL(upload, { width: 800, format: 'webp' });
const srcset = imageSrcSet(upload, [400, 800, 1600], { format: 'webp' });
// -> 'https://img.example.com/.../w_400,f_webp/photos/sunset.jpg 400w, https://img.example.com/.../w_800,f_webp/photos/sunset.jpg 800w, ...'
```

Pair it with `sizes` on the `<img>`, and the browser picks the width it needs.

## The reference service

ohne ships the protocol; a reference implementation on Node and sharp lives in its own package,
since sharp is a native dependency and ohne has none. Any implementation that follows the six
steps above works, including one behind a CDN or on an edge runtime.
