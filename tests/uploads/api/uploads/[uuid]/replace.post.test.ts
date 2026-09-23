import { deepStrictEqual, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import replacePost from '../../../../../src/uploads/api/uploads/[uuid]/replace.post.ts';
import { createFolder } from '../../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../../src/uploads/uploads/update-upload.ts';
import {
  bytes,
  call,
  errorsOf,
  png,
  route,
  stalled,
  storage,
  stream,
  text,
  userWith,
  withReadAccess,
} from '../../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const replace = route('POST', '/uploads/[uuid]/replace', replacePost);
const admin = await userWith('admin@example.com', ['uploads-admin']);

function send(uuid: string, body?: ReadableStream<Uint8Array>, bearer?: string): Promise<Response> {
  return call(replace, `/uploads/${uuid}/replace`, { uuid }, { bearer, body });
}

describe('POST /uploads/[uuid]/replace', () => {
  it('swaps the bytes and answers the record', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'pic.png', body: stream(png(1, 1)) });
    const next = png(64, 32);
    const response = await send(upload.UUID, stream(next), admin);
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.path, 'rep/pic.png');
    strictEqual(record.hash, createHash('sha256').update(next).digest('hex'));
    strictEqual(record.width, 64);
    deepStrictEqual(storage.objects.get('rep/pic.png'), next);
  });

  it('422s a folder, naming the key', async () => {
    const folder = await createFolder({ directory: 'rep', name: 'folder' });
    const response = await send(folder.UUID, stream(bytes('x')), admin);
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'uploads.errors.notAFile');
  });

  it('400s a missing body and 404s an unknown UUID', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'a.txt', body: stream(bytes('a')) });
    strictEqual((await send(upload.UUID, undefined, admin)).status, 400);
    strictEqual((await send('missing', stream(bytes('x')), admin)).status, 404);
  });

  it('401s without a user', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'b.txt', body: stream(bytes('b')) });
    strictEqual((await send(upload.UUID, stream(bytes('c')))).status, 401);
    strictEqual(text(storage.objects.get('rep/b.txt')), 'b');
  });

  it('404s a file the read access scope hides before staging a byte', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'hid.txt', body: stream(bytes('h')) });
    await updateUpload(upload.UUID, { private: true });
    const staged = new Set(storage.objects.keys());
    const journal = await queryUntyped('UploadsJournal').where({ op: 'stage' }).count();
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        strictEqual((await send(upload.UUID, stream(bytes('new')), admin)).status, 404);
        strictEqual((await send(upload.UUID, undefined, admin)).status, 404);
      },
    );
    const row = await queryUntyped('Uploads').where({ UUID: upload.UUID }).findFirst();
    strictEqual(row?.hash, upload.hash);
    strictEqual(text(storage.objects.get('rep/hid.txt')), 'h');
    deepStrictEqual(new Set(storage.objects.keys()), staged);
    strictEqual(await queryUntyped('UploadsJournal').where({ op: 'stage' }).count(), journal);
  });

  it('404s a file the scope hides by the time its bytes are staged, dropping them', async () => {
    const upload = await putUpload({
      directory: 'rep',
      name: 'late.txt',
      body: stream(bytes('l')),
    });
    const staged = new Set(storage.objects.keys());
    const lock = () => updateUpload(upload.UUID, { private: true }).then(() => undefined);
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        const response = await send(upload.UUID, stalled('new ', lock, 'bytes'), admin);
        strictEqual(response.status, 404);
      },
    );
    const row = await queryUntyped('Uploads').where({ UUID: upload.UUID }).findFirst();
    strictEqual(row?.hash, upload.hash);
    strictEqual(text(storage.objects.get('rep/late.txt')), 'l');
    deepStrictEqual(new Set(storage.objects.keys()), staged);
  });
});
