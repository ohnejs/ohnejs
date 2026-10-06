# Webhooks

A website that caches its pages needs to know when they change. Webhooks tell it.

List the URLs to call, each with a secret:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]' },
    webhooks: [{ url: 'https://example.com/api/ohne', secret: process.env.WEBHOOK_SECRET! }],
  },
});
```

A URL must be `https`, or `http` on `localhost`. A secret has at least 16 characters.

## What is sent

Every saved change to a page, the site settings, or a redirect sends a `POST` with a JSON body:

```json
{ "event": "update", "collection": "Pages", "uuids": ["01a10e2a-156a-7c83-bfc1-7f0e62eaa859"], "at": 1791331200000 }
```

- `event` - `create`, `update`, or `delete`.
- `collection` - the collection the records belong to, like `Pages`, `Site`, or `Redirects`.
- `uuids` - the changed records.
- `at` - when the change was committed, in epoch milliseconds.

A failed delivery is logged, not retried.

## Checking the signature

Anyone can call your URL, so check that the CMS sent the request. `verifyWebhook` answers the event,
or `null` when the signature is wrong or more than five minutes old:

```ts
// app/api/ohne/route.ts
import { verifyWebhook } from '@ohnejs/client';
import { revalidatePath } from 'next/cache';

export async function POST(request: Request) {
  const event = await verifyWebhook(request, process.env.WEBHOOK_SECRET!);
  if (event === null) return new Response(null, { status: 401 });
  revalidatePath('/', 'layout');
  return new Response(null, { status: 204 });
}
```

To check it in another language: the `Ohne-Signature` header reads `t=<seconds>,v1=<signature>`.
The signature is the HMAC-SHA256 of `<seconds>.<body>` under your secret, encoded as base64url
without padding. Refuse a `t` more than five minutes off your clock, as `verifyWebhook` does.
