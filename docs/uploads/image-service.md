# The image service

An image service renders the variants ohne signs: it answers a variant URL with the resized,
re-encoded image and caches the result. The reference implementation, `ohne-images`, is one. Read
on when you write your own or check one against the protocol; to use variants in an app, see
[image variants](./images.md).

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

## Signing

```
signature = base64url(HMAC-SHA256(secret, transforms + '/' + path))
```

Plain HMAC over the raw string, no derived keys, so any language implements it in three lines.
Vectors to test an implementation against:

| secret    | transforms               | path                | signature                                     |
| --------- | ------------------------ | ------------------- | --------------------------------------------- |
| `secret`  | `w_800,f_webp`           | `photos/sunset.jpg` | `2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck` |
| `another` | `w_320,h_320,fit_inside` | `photos/sunset.jpg` | `s9YxH4SXC6gGsS97gs_WMTAcNvgSnZe7zUBB__NeUMs` |

A service holds a list of secrets and accepts a URL signed by any of them, so an app can
[rotate its secret](./images.md#rotating-the-secret) without breaking pages. No URL carries an
expiry: variant URLs live in pages and in caches, and a leaked URL grants nothing beyond the one
variant it names.

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

An SVG has no pixels of its own, so the `dpr` 1 cap does not apply to it. Rasterize it at the
density the output needs, then fit; scaling up a low-density raster instead blurs every edge. An
SVG without `width`, `height`, or `viewBox` may render from its ink bounds, depending on the
rasterizer, so give an uploaded SVG a `viewBox`. Its thumbnail is a WebP raster like any other.

A service may also refuse every variant the app did not name; see
[named variants](./images.md#named-variants) for the allowlist the reference service reads.
