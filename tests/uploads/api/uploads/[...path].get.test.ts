import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import pathGet from '../../../../src/uploads/api/uploads/[...path].get.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { bytes, call, png, route, stream } from '../../_fixture.ts';

const serve = route('GET', '/uploads/[...path]', pathGet);

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

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return call(serve, `/uploads/${path}`, { path }, { headers });
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
