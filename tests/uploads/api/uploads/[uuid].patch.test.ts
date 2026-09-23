import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import uuidPatch from '../../../../src/uploads/api/uploads/[uuid].patch.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
import {
  bytes,
  call,
  route,
  stalled,
  storage,
  stream,
  text,
  errorsOf,
  userWith,
  withReadAccess,
} from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const patch = route('PATCH', '/uploads/[uuid]', uuidPatch);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);
useRoles().register('uploads-updater', {
  name: 'uploads-updater',
  role: { capabilities: ['collection.Uploads.update'] },
});
const updater = await userWith('updater@example.com', ['uploads-updater']);
const visibleOnly = () => ({ where: { private: false } });
const filesOnly = () => ({ where: { kind: 'file' } });

async function vault(name: string): Promise<string> {
  const folder = await createFolder({ directory: 'patch', name });
  await updateUpload(folder.UUID, { private: true });
  return folder.UUID;
}

async function refused(response: Response): Promise<void> {
  strictEqual(response.status, 422);
  strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
}

async function pinned(response: Response): Promise<void> {
  strictEqual(response.status, 422);
  strictEqual(errorsOf(await response.json()).private, 'uploads.errors.insidePrivateFolder');
}

async function seed(name: string): Promise<string> {
  const upload = await putUpload({ directory: 'patch', name, body: stream(bytes(name)) });
  return upload.UUID;
}

function send(uuid: string, json: unknown, bearer = admin, qs = ''): Promise<Response> {
  return call(patch, `/uploads/${uuid}${qs}`, { uuid }, { bearer, json });
}

describe('PATCH /uploads/[uuid]', () => {
  it('moves the row and its object', async () => {
    const uuid = await seed('a.txt');
    const response = await send(uuid, { directory: 'patch/moved', name: 'Renamed.txt' });
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.path, 'patch/moved/renamed.txt');
    strictEqual(text(storage.objects.get('patch/moved/renamed.txt')), 'a.txt');
    strictEqual(storage.objects.has('patch/a.txt'), false);
  });

  it('updates the metadata, at the requested locale', async () => {
    const uuid = await seed('b.txt');
    const response = await send(
      uuid,
      { description: 'Beschreibung', focalX: 0.5 },
      admin,
      '?locale=de',
    );
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.description, 'Beschreibung');
    strictEqual(record.focalX, 0.5);
    const english = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(english?.description, null);
  });

  it('moves and updates in one request, answering the final record', async () => {
    const uuid = await seed('c.txt');
    const response = await send(uuid, { name: 'd.txt', description: 'both' });
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.path, 'patch/d.txt');
    strictEqual(record.description, 'both');
  });

  it('400s a body naming nothing or of the wrong shape', async () => {
    const uuid = await seed('e.txt');
    strictEqual((await send(uuid, {})).status, 400);
    strictEqual((await send(uuid, null)).status, 400);
    strictEqual((await send(uuid, { name: 7 })).status, 400);
    strictEqual((await send(uuid, { focalX: 'left' })).status, 400);
    strictEqual((await send(uuid, { private: 'yes' })).status, 400);
  });

  it('ignores private while no secret makes the layer keep private files', async () => {
    const uuid = await seed('p.txt');
    useEnv().unset('UPLOADS_SECRET');
    try {
      strictEqual((await send(uuid, { private: true })).status, 400);
      const response = await send(uuid, { private: true, description: 'Note' });
      strictEqual(response.status, 200);
      const record = (await response.json()) as Record<string, unknown>;
      strictEqual(record.private, false);
      strictEqual(record.description, 'Note');
    } finally {
      useEnv().set('UPLOADS_SECRET', 'secret');
    }
  });

  it('locks a folder and everything inside it', async () => {
    await putUpload({ directory: 'patch/tree', name: 'leaf.txt', body: stream(bytes('leaf')) });
    const folder = await queryUntyped('Uploads')
      .where({ directory: 'patch', name: 'tree' })
      .findFirst();
    ok(folder);
    const response = await send(folder.UUID as string, { private: true });
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.private, true);
    const leaf = await queryUntyped('Uploads')
      .where({ directory: 'patch/tree', name: 'leaf.txt' })
      .findFirst();
    strictEqual(leaf?.private, true);
    strictEqual(storage.visibility.get('patch/tree/leaf.txt'), true);
  });

  it('422s a move into a private folder that also unlocks, leaving the row in place', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: 'patch',
      name: 'vault',
      private: true,
    });
    const uuid = await seed('j.txt');
    await pinned(await send(uuid, { directory: 'patch/vault', private: false }));
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.directory, 'patch');
    strictEqual(row?.private, false);
    const moved = await send(await seed('k.txt'), { directory: 'patch/vault' });
    strictEqual(((await moved.json()) as Record<string, unknown>).private, true);
  });

  it('422s an extension change and a focal point out of range', async () => {
    const uuid = await seed('f.txt');
    strictEqual((await send(uuid, { name: 'f.md' })).status, 422);
    strictEqual((await send(uuid, { focalY: 3 })).status, 422);
  });

  it('400s an unknown locale', async () => {
    const uuid = await seed('g.txt');
    strictEqual((await send(uuid, { description: 'x' }, admin, '?locale=xx')).status, 400);
  });

  it('404s an unknown UUID', async () => {
    strictEqual((await send('missing', { name: 'x.txt' })).status, 404);
  });

  it('401s without a user and 403s without the capability', async () => {
    const uuid = await seed('h.txt');
    strictEqual(
      (await call(patch, `/uploads/${uuid}`, { uuid }, { json: { name: 'i.txt' } })).status,
      401,
    );
    strictEqual((await send(uuid, { name: 'i.txt' }, nobody)).status, 403);
    strictEqual(storage.objects.has('patch/h.txt'), true);
  });

  it('404s a row the read access scope hides, leaving it untouched', async () => {
    const uuid = await seed('secret.txt');
    await updateUpload(uuid, { private: true });
    await withReadAccess(visibleOnly, async () => {
      const bodies = [
        { description: 'x' },
        { name: 'moved.txt' },
        { directory: 'patch/elsewhere', description: 'x' },
        { private: false },
        { name: 7 },
      ];
      for (const body of bodies) strictEqual((await send(uuid, body)).status, 404);
    });
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.name, 'secret.txt');
    strictEqual(row?.directory, 'patch');
    strictEqual(row?.description, null);
    strictEqual(row?.private, true);
    strictEqual(storage.objects.has('patch/secret.txt'), true);
    strictEqual(storage.visibility.get('patch/secret.txt'), true);
  });

  it('changes a row the read access scope admits', async () => {
    const uuid = await seed('seen.txt');
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send(uuid, { description: 'seen' })).status, 200);
    });
  });

  it('moves a visible folder with a file the scope hides inside it', async () => {
    const folder = await createFolder({ directory: 'patch', name: 'shown' });
    const inner = await putUpload({
      directory: 'patch/shown',
      name: 'inner.txt',
      body: stream(bytes('inner')),
    });
    await updateUpload(inner.UUID, { private: true });
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send(folder.UUID, { name: 'renamed' })).status, 200);
    });
    const moved = await queryUntyped('Uploads').where({ UUID: inner.UUID }).findFirst();
    strictEqual(moved?.directory, 'patch/renamed');
    strictEqual(text(storage.objects.get('patch/renamed/inner.txt')), 'inner');
  });

  it('422s a visible folder moving into a private one and unlocking, keeping hidden files private', async () => {
    const folder = await createFolder({ directory: 'patch', name: 'open' });
    const inner = await putUpload({
      directory: 'patch/open',
      name: 'hush.txt',
      body: stream(bytes('hush')),
    });
    await updateUpload(inner.UUID, { private: true });
    const vault = await createFolder({ directory: 'patch', name: 'safe' });
    await updateUpload(vault.UUID, { private: true });
    await withReadAccess(visibleOnly, async () => {
      await pinned(await send(folder.UUID, { directory: 'patch/safe', private: false }));
    });
    const open = await queryUntyped('Uploads').where({ UUID: folder.UUID }).findFirst();
    strictEqual(open?.directory, 'patch');
    const hidden = await queryUntyped('Uploads').where({ UUID: inner.UUID }).findFirst();
    strictEqual(hidden?.directory, 'patch/open');
    strictEqual(hidden?.private, true);
    strictEqual(storage.visibility.get('patch/open/hush.txt'), true);
  });

  it('404s a row the scope hides by the time a slow body arrives', async () => {
    const uuid = await seed('slow.txt');
    const lock = () => updateUpload(uuid, { private: true }).then(() => undefined);
    await withReadAccess(visibleOnly, async () => {
      const body = stalled('{"private":', lock, 'false}');
      const headers = { 'content-type': 'application/json' };
      const response = await call(
        patch,
        `/uploads/${uuid}`,
        { uuid },
        { bearer: admin, body, headers },
      );
      strictEqual(response.status, 404);
    });
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.private, true);
  });

  it('403s the update capability without the read one', async () => {
    const uuid = await seed('l.txt');
    strictEqual((await send(uuid, { description: 'x' }, updater)).status, 403);
  });

  it('404s every row under a false read verdict', async () => {
    const uuid = await seed('m.txt');
    await withReadAccess(
      () => false,
      async () => {
        strictEqual((await send(uuid, { description: 'x' })).status, 404);
      },
    );
  });

  it('422s making a visible file private, leaving it public', async () => {
    const uuid = await seed('shy.txt');
    await withReadAccess(visibleOnly, async () => {
      await refused(await send(uuid, { private: true }));
    });
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.private, false);
    strictEqual(storage.visibility.has('patch/shy.txt'), false);
  });

  it('422s locking a visible folder with a visible file inside, changing neither', async () => {
    const folder = await createFolder({ directory: 'patch', name: 'plain' });
    const inner = await putUpload({
      directory: 'patch/plain',
      name: 'seen.txt',
      body: stream(bytes('seen')),
    });
    await withReadAccess(visibleOnly, async () => {
      await refused(await send(folder.UUID, { private: true }));
    });
    const rows = await queryUntyped('Uploads')
      .where({ UUID: { in: [folder.UUID, inner.UUID] } })
      .pluck('private');
    deepStrictEqual(rows, [false, false]);
    strictEqual(storage.visibility.has('patch/plain/seen.txt'), false);
  });

  it('422s moving a visible file into a private folder, leaving it in place', async () => {
    await vault('crypt');
    const uuid = await seed('stay.txt');
    await withReadAccess(visibleOnly, async () => {
      await refused(await send(uuid, { directory: 'patch/crypt' }));
    });
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.directory, 'patch');
    strictEqual(row?.private, false);
    strictEqual(text(storage.objects.get('patch/stay.txt')), 'stay.txt');
    strictEqual(storage.objects.has('patch/crypt/stay.txt'), false);
  });

  it('422s a move that creates a hidden folder on the way, creating nothing', async () => {
    const uuid = await seed('down.txt');
    await withReadAccess(filesOnly, async () => {
      await refused(await send(uuid, { directory: 'patch/cellar/new' }));
    });
    strictEqual(
      await queryUntyped('Uploads').where({ directory: 'patch', name: 'cellar' }).count(),
      0,
    );
    strictEqual(
      (await queryUntyped('Uploads').where({ UUID: uuid }).findFirst())?.directory,
      'patch',
    );
  });

  it('applies a move and its changes together or not at all', async () => {
    const uuid = await seed('whole.txt');
    strictEqual((await send(uuid, { name: 'part.txt', focalX: 5 })).status, 422);
    const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
    strictEqual(row?.name, 'whole.txt');
    strictEqual(text(storage.objects.get('patch/whole.txt')), 'whole.txt');
    strictEqual(storage.objects.has('patch/part.txt'), false);
  });
});
