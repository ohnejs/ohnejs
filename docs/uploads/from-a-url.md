# Uploading from a URL

When a file is already online, you can store it from its URL instead of downloading it first. The
server fetches the URL and stores the file as if it had been
[uploaded](./uploads.md#uploading-over-http), with the same slug names, type check, and SVG
sanitizing.

In the dashboard, the link button beside Upload asks for the URL. Over HTTP, post it to
`POST /uploads/fetch`:

```sh
curl -X POST http://localhost:9001/uploads/fetch \
  -H 'content-type: application/json' --cookie "session=..." \
  -d '{"url": "https://example.com/Thrall.JPG", "directory": "heroes"}'
```

The answer is `201` with the record, whose `path` is `heroes/thrall.jpg`.

## Naming the file

`name` is optional, beside `url` and `directory`. Omitted, the file takes the first name it finds:

- the response's `Content-Disposition`,
- the last segment of the URL, after any redirects,
- `file`.

A name without a known extension gains the one the response's `Content-Type` stands for. The type
still comes from the extension and is checked against the bytes, so a wrong header never stores
what `uploads.types` refuses.

The URL itself is never stored or logged, so a signed link's token stays private.

## In server code

`fetchUpload` does the same from server code, such as a [command](../project/commands.md):

```ts
// commands/import-logo.ts
import { fetchUpload } from 'ohnejs/uploads';
import { defineCommand } from 'ohnejs/utils/cli';

export default defineCommand({
  meta: { name: 'import-logo', description: 'Fetch the logo into Media.' },
  async run() {
    await fetchUpload({ url: 'https://example.com/logo.png', directory: 'brand' });
  },
});
```

## Who may fetch

The route needs the `uploads.fetch` [capability](../auth/roles.md#custom-capabilities) beside
`collection.Uploads.create`:

```ts
// roles/editor.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.Uploads.*', 'uploads.fetch'],
});
```

- `collection.Uploads.*` does not cover it: a fetch leaves from your server's address, which
  partners and internal services may trust.
- The dashboard's link button shows only for a viewer who holds both.

## Turning it off

A role granted `*` holds every capability, `uploads.fetch` included. To turn fetching off for
everyone, admins included, [drop its route](../project/config.md#disabling):

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  disable: { routes: ['POST /uploads/fetch'] },
});
```

The dashboard then hides the link button from every viewer.

## Limits

Every fetch is bounded:

- `uploads.maxFileSize` caps the file, and `uploads.maxSVGSize` an SVG, as they do every upload.
- `uploads.fetch.timeout` bounds the whole fetch, redirects and body included. Omitted, it is
  2 minutes.
- Whatever the timeout, the source must start answering within 30 seconds, and never go quiet for
  longer than that while the file streams.
- The route runs at most two fetches per user at once, and eight in all. One more answers `429`.
- A fetch stops when the client that asked for it goes away.

## What a fetch may reach

A fetch reaches only what anyone on the internet could. The server refuses:

- private and internal addresses, such as `127.0.0.1`, `10.0.0.0/8`, and `169.254.169.254`, where
  clouds serve their metadata,
- the server's own addresses and every network they sit on, public ones included,
- ports other than 80 and 443,
- schemes other than `http:` and `https:`, and credentials in the URL, as in
  `https://thrall:secret@example.com`,
- a redirect to any of those, a redirect from `https:` to `http:`, and more than five redirects.

A refused address or port fails like a host that is down, with `urlUnreachable` at `url`, so the
error never tells an editor what sits behind your firewall.

A fetch connects directly, never through `HTTP_PROXY` or `HTTPS_PROXY`, even with
`NODE_USE_ENV_PROXY` set, since a proxy would resolve the name where these checks cannot see it. On
a network that reaches the internet only through a proxy, every fetch is `urlUnreachable`.

## Fetching from your network

`uploads.fetch.allow` opens addresses that are not public, for sources on your intranet:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: { fetch: { allow: ['10.20.0.0/16'] } },
});
```

- It lists addresses and CIDR blocks, and a listed address is fetched on any port.
- List addresses, not names: a name is checked by the addresses it resolves to.
- A wide block such as `'0.0.0.0/0'` turns the guard off, and anyone who may fetch can read your
  network and its cloud metadata.
