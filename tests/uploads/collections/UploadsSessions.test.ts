import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { QueryRecord } from '../../../src/ohne/query/read/find.ts';

import { queryUntyped } from '../../../src/ohne/query/query.ts';
import '../_fixture.ts';

const HOUR = 60 * 60 * 1000;

/**
 * Creates a session row for `name` in `directory`, owned by `author`.
 */
function createSession(
  name: string,
  { directory = '', author = null }: { directory?: string; author?: string | null } = {},
): Promise<QueryRecord> {
  return queryUntyped('UploadsSessions')
    .unscoped()
    .createOrThrow({
      author,
      directory,
      name,
      type: 'video/mp4',
      size: 12,
      chunkSize: 5,
      expiresAt: Date.now() + HOUR,
    });
}

/**
 * Reads the session row `uuid` back, `undefined` once it is gone.
 */
function readSession(uuid: unknown): Promise<QueryRecord | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

describe('UploadsSessions', () => {
  it('canonicalizes the location and starts with nothing confirmed', async () => {
    const session = await createSession('Frostmourne Forging.MP4', {
      directory: 'Northrend//Icecrown/',
    });
    const { directory, name, offset, hashState, token, receipts, width, height, upload } = session;
    deepStrictEqual(
      { directory, name, offset, hashState, token, receipts, width, height, upload },
      {
        directory: 'northrend/icecrown',
        name: 'frostmourne-forging.mp4',
        offset: 0,
        hashState: null,
        token: null,
        receipts: '[]',
        width: null,
        height: null,
        upload: null,
      },
    );
  });

  it('drops the session with the upload it landed as', async () => {
    const upload = await queryUntyped('Uploads').createOrThrow({
      kind: 'file',
      directory: '',
      name: 'lordaeron-throne-room.mp4',
      type: 'video/mp4',
      size: 12,
    });
    const session = await createSession('lordaeron-throne-room.mp4');
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: session.UUID })
      .updateOrThrow({ upload: upload.UUID });
    await queryUntyped('Uploads').where({ UUID: upload.UUID }).delete();
    strictEqual(await readSession(session.UUID), undefined);
  });

  it('keeps the session of a deleted user, for the sweep', async () => {
    const user = await queryUntyped('Users').createOrThrow({
      email: 'arthas@lordaeron.test',
      password: 'pw-123456',
      roles: [],
    });
    const session = await createSession('stratholme.mp4', { author: user.UUID as string });
    await queryUntyped('Users').where({ UUID: user.UUID }).delete();
    strictEqual((await readSession(session.UUID))?.author, null);
  });
});
