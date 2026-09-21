# The image service

An image service renders the variants ohne signs: it answers a variant URL with the resized,
re-encoded image and caches the result. The reference implementation, `ohne-images`, is one. This
page is for writing your own, or checking one against the protocol. To use variants in an app, read
[image variants](./images.md) instead.

## The URL

```
{images.url}/{signature}/{transforms}/{path}
https://img.example.com/2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck/w_800,f_webp/photos/sunset.jpg
```

- `path` is the [upload's path](./uploads.md#the-collection), `directory` and `name` joined:
  `photos/2024/sunset.jpg`. Every segment is a slug, so the path needs no encoding.
- `transforms` is a comma-separated list of `name_value` tokens, never empty.
- `signature` is the base64url HMAC-SHA256 of the string `{transforms}/{path}`, with the secret as
  the key. It is 43 characters long and has no padding.

A service answers a URL only when the signature is valid, so nobody can ask it for a size ohne
did not sign. Signing happens in server code, and the secret never reaches a browser.

## Transforms

| token | value                                                                                                                                  | default                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `w`   | target width in pixels, a positive integer                                                                                             |                                              |
| `h`   | target height in pixels, a positive integer                                                                                            |                                              |
| `fit` | `cover` fills the box and crops, `contain` shrinks to fit and pads, `inside` shrinks to fit                                            | `cover`                                      |
| `f`   | `webp`, `avif`, `jpeg`, `png`, or `auto`                                                                                               | the source format, `png` for a vector source |
| `q`   | encoding quality, `1` to `100`                                                                                                         | the service's own                            |
| `p`   | where a `cover` crop keeps its subject: `center`, `top`, `topRight`, `right`, `bottomRight`, `bottom`, `bottomLeft`, `left`, `topLeft` | `center`                                     |
| `fp`  | focal point of a `cover` crop as `fp_x_y`, each axis `0` to `1` with up to three decimals. Replaces `p`                                |                                              |
| `dpr` | device pixel ratio the size is multiplied by, `1` to `4`, up to two decimals                                                           | `1`                                          |

The token string is canonical, and ohne writes no other spelling:

- Tokens follow the table's order.
- A default is never written.
- A token appears at most once.

Equal transforms therefore always give one string and one URL, so the service and every cache in
front of it can identify a variant by its URL.

## Signing

```
signature = base64url(HMAC-SHA256(secret, transforms + '/' + path))
```

This is plain HMAC over the raw string, with no derived keys, so you can implement it in three lines
in any language. Test your implementation against these values:

| secret    | transforms               | path                | signature                                     |
| --------- | ------------------------ | ------------------- | --------------------------------------------- |
| `secret`  | `w_800,f_webp`           | `photos/sunset.jpg` | `2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck` |
| `another` | `w_320,h_320,fit_inside` | `photos/sunset.jpg` | `s9YxH4SXC6gGsS97gs_WMTAcNvgSnZe7zUBB__NeUMs` |

A service holds a list of secrets and accepts a URL signed by any of them, so an app can
[rotate its secret](./images.md#rotating-the-secret) without breaking pages. A URL has no expiry
date: variant URLs live in pages and in caches, and a leaked URL gives access only to the one
variant it names.

## What a service does

1. Split the path into three parts: the first segment is the signature, the second is the
   transforms, and the rest is the source path. Answer `404` to fewer than three segments. Ignore
   the query string, for routing and for the cache key, so nobody forces a re-render by changing it.
2. Verify the signature over the raw `{transforms}/{path}` string before parsing anything. Answer
   `403` when it is not valid. An [unsigned service](./images.md#connecting-a-service), meant for
   a local machine, skips this step.
3. Parse the transforms. Answer `400` to an empty segment, an unknown token, an out-of-range value,
   a duplicate, or both `p` and `fp`.
4. Fetch the source at `{sourceURL}/{path}`, where `sourceURL` is the service's own setting,
   normally the app's [`/uploads` origin](./uploads.md#serving).
   - Answer `404` when the origin does, and `502` when it is unreachable, both with
     `Cache-Control: no-store`.
   - Revalidate a fetched source with `If-None-Match` at a short interval, for example one minute.
     Drop its variants when the `ETag` changes, so a [replaced file](./uploads.md#in-server-code)
     gets new variants.
   - When the origin sends no `ETag`, hash the bytes and use the hash instead.
5. Render:
   - **Size.** Multiply `w` and `h` by `dpr` before fitting. At `dpr` 1 never scale the source up:
     `inside` and `contain` do not enlarge, and `cover` shrinks the box at its own ratio until the
     source fills it.
   - **Crop.** Position by `p` or `fp` only for `cover`, since `contain` and `inside` do not crop.
     Pad `contain` to the full box with transparency, or white for `jpeg`. Padding is not
     enlargement.
   - **Metadata.** Apply the EXIF orientation, then strip the metadata.
   - **Encode.** Encode in `f` at `q`. On `png`, `q` is palette quantization. Without `f`, keep the
     source format, and encode a vector source as `png`.
   - **`f_auto`.** Pick `avif` when `Accept` contains `image/avif`, else `webp` when it contains
     `image/webp`, else the source format. `image/*` alone means the source format. Add
     `Vary: Accept` to the answer.
   - **SVG.** An SVG has no pixels of its own, so the `dpr` 1 limit does not apply to it. Rasterize
     it at the density the output needs, then fit, since scaling up a low-density raster blurs every
     edge. An SVG without `width`, `height`, or `viewBox` may render at the size of its drawn
     shapes, depending on the rasterizer, so give an uploaded SVG a `viewBox`. Its thumbnail is a
     WebP raster like any other.
6. Answer with the rendered bytes, `Content-Type`, and a long `Cache-Control: public, max-age`, and
   keep the result cached by URL for the next request. With `f_auto` the negotiated format is also
   part of the cache key, since the URL alone no longer identifies the bytes.

A service may also refuse
[every variant the app did not name](./images.md#allowing-only-your-variants).
