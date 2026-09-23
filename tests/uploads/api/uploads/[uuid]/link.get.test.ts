import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
import { useRoles } from '../../../../../src/ohne/roles/use-roles.ts';
import linkGet from '../../../../../src/uploads/api/uploads/[uuid]/link.get.ts';
import { createFolder } from '../../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../../src/uploads/uploads/update-upload.ts';
import { uploadURL } from '../../../../../src/uploads/uploads/url.ts';
import { parseDuration } from '../../../../../src/utils/index.ts';
import {
  bytes,
  call,
  errorsOf,
  route,
  stream,
  userWith,
  withReadAccess,
} from '../../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const link = route('GET', '/uploads/[uuid]/link', linkGet);

useRoles().register('uploads-reader', {
  name: 'uploads-reader',
  role: { capabilities: ['collection.Uploads.read'] },
});
const reader = await userWith('reader@example.com', ['uploads-reader']);
const nobody = await userWith('nobody@example.com', []);

const open = await putUpload({ directory: 'link', name: 'open.txt', body: stream(bytes('o')) });
const hidden = await putUpload({ directory: 'link', name: 'hidden.txt', body: stream(bytes('h')) });
await updateUpload(hidden.UUID, { private: true });
const folder = await createFolder({ directory: 'link', name: 'folder' });

function send(uuid: string, qs = '', bearer = reader): Promise<Response> {
  return call(link, `/uploads/${uuid}/link${qs}`, { uuid }, { bearer });
}

async function answer(uuid: string, qs = ''): Promise<{ url: string; expires: number | null }> {
  const response = await send(uuid, qs);
  strictEqual(response.status, 200);
  return (await response.json()) as { url: string; expires: number | null };
}

/**
 * Asserts `expires` lies within a minute past `before` plus `maxAge`, and returns it.
 */
function expiresAbout(expires: number | null, before: number, maxAge: string): number {
  ok(expires !== null);
  const drift = expires - before - parseDuration(maxAge);
  ok(drift >= 0 && drift < parseDuration('1m'), `expires drifts ${drift}ms`);
  return expires;
}

describe('GET /uploads/[uuid]/link', () => {
  beforeEach(() => useEnv().set('UPLOADS_SECRET', 'secret'));
  afterEach(() => useEnv().unset('UPLOADS_SECRET'));

  it('signs a private file for uploads.privateMaxAge by default', async () => {
    const before = Date.now();
    const answered = await answer(hidden.UUID);
    const expires = expiresAbout(answered.expires, before, '1h');
    strictEqual(
      answered.url,
      uploadURL({ directory: 'link', name: 'hidden.txt', private: true, expires }),
    );
    match(answered.url, /^\/uploads\/link\/hidden\.txt\?e=\d+&s=[A-Za-z0-9_-]{43}$/);
  });

  it('takes maxAge as a parseDuration value', async () => {
    const before = Date.now();
    expiresAbout((await answer(hidden.UUID, '?maxAge=7d')).expires, before, '7d');
    expiresAbout((await answer(hidden.UUID, '?maxAge=90s')).expires, before, '90s');
    expiresAbout((await answer(hidden.UUID, '?maxAge=5000')).expires, before, '5s');
  });

  it('400s a maxAge parseDuration rejects, or of another shape', async () => {
    for (const qs of ['?maxAge=soon', '?maxAge=-1h', '?maxAge=[1,2]', '?maxAge']) {
      strictEqual((await send(hidden.UUID, qs)).status, 400, qs);
    }
  });

  it('answers a public file its plain url with no expiry', async () => {
    deepStrictEqual(await answer(open.UUID, '?maxAge=7d'), {
      url: '/uploads/link/open.txt',
      expires: null,
    });
  });

  it('422s a folder, naming the key', async () => {
    const response = await send(folder.UUID);
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'uploads.errors.notAFile');
  });

  it('404s an unknown UUID and a row the read access scope hides', async () => {
    strictEqual((await send('missing')).status, 404);
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        strictEqual((await send(hidden.UUID)).status, 404);
        strictEqual((await send(open.UUID)).status, 200);
      },
    );
  });

  it('401s without a user and 403s without the capability', async () => {
    const uuid = hidden.UUID;
    strictEqual((await call(link, `/uploads/${uuid}/link`, { uuid })).status, 401);
    strictEqual((await send(uuid, '', nobody)).status, 403);
  });

  it('404s every file while no secret makes the layer keep private files', async () => {
    useEnv().unset('UPLOADS_SECRET');
    try {
      strictEqual((await send(hidden.UUID)).status, 404);
      strictEqual((await send(open.UUID)).status, 404);
    } finally {
      useEnv().set('UPLOADS_SECRET', 'secret');
    }
  });
});
