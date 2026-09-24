import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import pathGet from '../../../../src/uploads/api/uploads/[...path].get.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { signUploadLink } from '../../../../src/uploads/uploads/sign.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
import { stringifySearchParams } from '../../../../src/utils/index.ts';
import { bytes, call, png, route, stream, userWith, withReadAccess } from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const serve = route('GET', '/uploads/[...path]', pathGet);

useRoles().register('uploads-reader', {
  name: 'uploads-reader',
  role: { capabilities: ['collection.Uploads.read'] },
});
const reader = await userWith('reader@example.com', ['uploads-reader']);
const nobody = await userWith('nobody@example.com', []);

const source = bytes('0123456789abcdef');
const note = await putUpload({ directory: 'serve', name: 'note.txt', body: stream(source) });
const page = await putUpload({
  directory: 'serve',
  name: 'page.html',
  body: stream(bytes('<p>hi</p>')),
});
const logo = await putUpload({
  directory: 'serve',
  name: 'logo.svg',
  body: stream(bytes('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')),
});
await putUpload({ directory: 'serve', name: 'pic.png', body: stream(png(4, 4)) });
await createFolder({ directory: 'serve', name: 'folder' });

const HIDDEN = 'serve/hidden.txt';
const hidden = await putUpload({
  directory: 'serve',
  name: 'hidden.txt',
  body: stream(bytes('hush')),
});
await updateUpload(hidden.UUID, { private: true });

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return call(serve, `/uploads/${path}`, { path }, { headers });
}

function getHidden(
  qs = '',
  init: { bearer?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return call(serve, `/uploads/${HIDDEN}${qs}`, { path: HIDDEN }, init);
}

function signed(expires: number, secret = 'secret'): string {
  return `?${stringifySearchParams({ e: expires, s: signUploadLink(HIDDEN, expires, secret) })}`;
}

async function withSecret<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = useEnv().get('UPLOADS_SECRET');
  useEnv().set('UPLOADS_SECRET', value);
  try {
    return await run();
  } finally {
    if (previous === undefined) useEnv().unset('UPLOADS_SECRET');
    else useEnv().set('UPLOADS_SECRET', previous);
  }
}

/**
 * Runs `run` with the layer's private files switched off, restoring the secret afterwards.
 */
async function withoutSecret<T>(run: () => Promise<T>): Promise<T> {
  const previous = useEnv().get('UPLOADS_SECRET');
  useEnv().unset('UPLOADS_SECRET');
  try {
    return await run();
  } finally {
    if (previous !== undefined) useEnv().set('UPLOADS_SECRET', previous);
  }
}

describe('GET /uploads/[...path]', () => {
  it('serves the bytes with the validators and the security headers', async () => {
    const response = await get('serve/note.txt');
    strictEqual(response.status, 200);
    strictEqual(await response.text(), '0123456789abcdef');
    strictEqual(response.headers.get('content-type'), 'text/plain');
    strictEqual(response.headers.get('content-length'), '16');
    strictEqual(response.headers.get('accept-ranges'), 'bytes');
    strictEqual(response.headers.get('etag'), `"${note.hash}"`);
    strictEqual(response.headers.get('cache-control'), 'no-cache');
    strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
    strictEqual(response.headers.get('content-disposition'), 'inline; filename="note.txt"');
    strictEqual(response.headers.get('content-security-policy'), null);
  });

  it('takes Cache-Control from uploads.cache', async () => {
    useLayers().add({
      path: '/uploads-cache',
      input: { uploads: { cache: { public: true, maxAge: 60 } } },
    });
    try {
      strictEqual((await get('serve/note.txt')).headers.get('cache-control'), 'public, max-age=60');
    } finally {
      useLayers().remove('/uploads-cache');
    }
  });

  it('answers a fresh If-None-Match with 304 and no body', async () => {
    const response = await get('serve/note.txt', { 'if-none-match': `"${note.hash}"` });
    strictEqual(response.status, 304);
    strictEqual(await response.text(), '');
    strictEqual(response.headers.get('etag'), `"${note.hash}"`);
    strictEqual((await get('serve/note.txt', { 'if-none-match': '"stale"' })).status, 200);
  });

  it('serves the first range with 206', async () => {
    const response = await get('serve/note.txt', { range: 'bytes=2-5, 8-9' });
    strictEqual(response.status, 206);
    strictEqual(await response.text(), '2345');
    strictEqual(response.headers.get('content-range'), 'bytes 2-5/16');
    strictEqual(response.headers.get('content-length'), '4');

    const tail = await get('serve/note.txt', { range: 'bytes=-3' });
    strictEqual(tail.status, 206);
    strictEqual(await tail.text(), 'def');
    strictEqual(tail.headers.get('content-range'), 'bytes 13-15/16');
  });

  it('answers a range past the end with 416 and no body', async () => {
    const response = await get('serve/note.txt', { range: 'bytes=100-' });
    strictEqual(response.status, 416);
    strictEqual(await response.text(), '');
    strictEqual(response.headers.get('content-range'), 'bytes */16');
  });

  it('ignores a range it cannot read', async () => {
    const response = await get('serve/note.txt', { range: 'items=0-1' });
    strictEqual(response.status, 200);
    strictEqual(response.headers.get('content-range'), null);
  });

  it('sandboxes an SVG', async () => {
    const response = await get('serve/logo.svg');
    strictEqual(response.status, 200);
    strictEqual(response.headers.get('content-type'), 'image/svg+xml');
    strictEqual(response.headers.get('etag'), `"${logo.hash}"`);
    strictEqual(
      response.headers.get('content-security-policy'),
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    strictEqual(response.headers.get('content-disposition'), 'inline; filename="logo.svg"');
  });

  it('downloads a script-capable type as an attachment', async () => {
    const response = await get('serve/page.html');
    strictEqual(response.status, 200);
    strictEqual(response.headers.get('content-type'), 'text/html');
    strictEqual(response.headers.get('etag'), `"${page.hash}"`);
    strictEqual(response.headers.get('content-disposition'), 'attachment; filename="page.html"');
  });

  it('serves an image inline', async () => {
    const response = await get('serve/pic.png');
    strictEqual(response.headers.get('content-type'), 'image/png');
    strictEqual(response.headers.get('content-disposition'), 'inline; filename="pic.png"');
  });

  it('404s a folder and an unknown path', async () => {
    strictEqual((await get('serve/folder')).status, 404);
    strictEqual((await get('serve/nope.txt')).status, 404);
    strictEqual((await get('serve')).status, 404);
  });
});

describe('GET /uploads/[...path] on a private file', () => {
  it('serves an unexpired signed link, marked private, ignoring other params', async () => {
    await withSecret('secret', async () => {
      const response = await getHidden(signed(Date.now() + 60_000));
      strictEqual(response.status, 200);
      strictEqual(await response.text(), 'hush');
      strictEqual(response.headers.get('cache-control'), 'private, no-cache');
      strictEqual(response.headers.get('etag'), `"${hidden.hash}"`);
      strictEqual((await getHidden(`${signed(Date.now() + 60_000)}&v=1`)).status, 200);
    });
  });

  it('verifies a link under any listed secret', async () => {
    await withSecret('new,old', async () => {
      strictEqual((await getHidden(signed(Date.now() + 60_000, 'old'))).status, 200);
      strictEqual((await getHidden(signed(Date.now() + 60_000, 'other'))).status, 404);
    });
  });

  it('404s an expired, tampered, or missing link, and any link without a secret', async () => {
    const expires = Date.now() + 60_000;
    await withSecret('secret', async () => {
      strictEqual((await getHidden(signed(Date.now() - 1))).status, 404);
      const s = signUploadLink(HIDDEN, expires, 'secret');
      strictEqual((await getHidden(`?e=${expires + 1}&s=${s}`)).status, 404);
      strictEqual((await getHidden(`?e=${expires}`)).status, 404);
      strictEqual((await getHidden(`?s=${s}`)).status, 404);
      strictEqual((await getHidden()).status, 404);
    });
  });

  it('stays closed to anyone while no secret can sign a link, open to a reader', async () => {
    await withoutSecret(async () => {
      strictEqual((await getHidden()).status, 404);
      const response = await getHidden('', { bearer: reader });
      strictEqual(response.status, 200);
      strictEqual(await response.text(), 'hush');
      strictEqual(response.headers.get('cache-control'), 'private, no-cache');
    });
  });

  it('opens for a signed-in reader with the capability, and for no one else', async () => {
    const response = await getHidden('', { bearer: reader });
    strictEqual(response.status, 200);
    strictEqual(await response.text(), 'hush');
    strictEqual(response.headers.get('cache-control'), 'private, no-cache');
    strictEqual((await getHidden('', { bearer: nobody })).status, 404);
  });

  it('never confirms the ETag to a caller who may not open it', async () => {
    const probe = await getHidden('', { headers: { 'if-none-match': `"${hidden.hash}"` } });
    strictEqual(probe.status, 404);
    strictEqual(probe.headers.get('etag'), null);
    const fresh = await getHidden('', {
      bearer: reader,
      headers: { 'if-none-match': `"${hidden.hash}"` },
    });
    strictEqual(fresh.status, 304);
  });

  it('honours a read access scope that hides the row, a signed link still opening it', async () => {
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        strictEqual((await getHidden('', { bearer: reader })).status, 404);
        strictEqual(
          (
            await call(
              serve,
              '/uploads/serve/note.txt',
              { path: 'serve/note.txt' },
              { bearer: reader },
            )
          ).status,
          200,
        );
        await withSecret('secret', async () => {
          strictEqual((await getHidden(signed(Date.now() + 60_000))).status, 200);
        });
      },
    );
  });

  it('marks uploads.cache private for a private file, never public', async () => {
    useLayers().add({
      path: '/uploads-cache',
      input: { uploads: { cache: { public: true, maxAge: 60 } } },
    });
    try {
      const response = await getHidden('', { bearer: reader });
      strictEqual(response.headers.get('cache-control'), 'private, max-age=60');
    } finally {
      useLayers().remove('/uploads-cache');
    }
  });
});
