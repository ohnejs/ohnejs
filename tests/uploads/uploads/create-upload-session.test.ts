import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { StorageWriteMeta } from '../../../src/uploads/storage/adapter.ts';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { translate } from '../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { sessionTemp } from '../../../src/uploads/uploads/_session.ts';
import { abortUploadSession } from '../../../src/uploads/uploads/abort-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { formatBytes } from '../../../src/utils/bytes/format-bytes.ts';
import { parseBytes } from '../../../src/utils/bytes/parse-bytes.ts';
import { holdSession, promptly, storage } from '../_fixture.ts';

const DAY = 24 * 60 * 60 * 1000;

const CHUNK_SIZE = parseBytes('8mb');

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * How many session rows exist.
 */
function sessions(): Promise<number> {
  return queryUntyped('UploadsSessions').unscoped().count();
}

/**
 * The field errors `run` rejects with.
 */
async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

/**
 * The `HTTPError` `run` rejects with.
 */
async function refusal(run: () => Promise<unknown>): Promise<HTTPError> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return error instanceof HTTPError;
  });
  return caught as HTTPError;
}

describe('createUploadSession', () => {
  it('opens a session at the canonical location, with the chunk size frozen and a handle', async () => {
    const start = Date.now();

    const session = await createUploadSession({
      directory: 'Northrend//Icecrown/',
      name: 'Frostmourne Forging.MP4',
      size: 20_000_000,
    });

    const { UUID, expiresAt, ...rest } = session;
    deepStrictEqual(rest, {
      directory: 'northrend/icecrown',
      name: 'frostmourne-forging.mp4',
      type: 'video/mp4',
      size: 20_000_000,
      chunkSize: CHUNK_SIZE,
      offset: 0,
      upload: null,
    });
    ok(expiresAt >= start + DAY && expiresAt <= Date.now() + DAY);
    const stored = await row(UUID);
    strictEqual(stored?.author, null);
    strictEqual(stored?.hashState, null);
    strictEqual(stored?.receipts, '[]');
    ok(storage.unfinished.has(stored?.token as string));
  });

  it('begins the write at the session temp with the type, the size, and the disposition', async () => {
    const parts = storage.parts!;
    const { begin } = parts;
    const calls: { path: string; meta: StorageWriteMeta }[] = [];
    parts.begin = (path, meta) => {
      calls.push({ path, meta });
      return begin(path, meta);
    };
    try {
      const page = await createUploadSession({ name: 'Scourge Invasion.html', size: 12 });
      const map = await createUploadSession({ name: 'azeroth.png', size: 40 });

      deepStrictEqual(calls, [
        {
          path: sessionTemp(page.UUID),
          meta: { type: 'text/html', size: 12, disposition: 'attachment' },
        },
        {
          path: sessionTemp(map.UUID),
          meta: { type: 'image/png', size: 40, disposition: 'inline' },
        },
      ]);
    } finally {
      parts.begin = begin;
    }
  });

  it('keeps the author and puts a session without a directory at the root', async () => {
    const user = await queryUntyped('Users').createOrThrow({
      email: 'uther@lordaeron.test',
      password: 'pw-123456',
      roles: [],
    });

    const session = await createUploadSession({
      name: 'Silver Hand.pdf',
      size: 9,
      author: user.UUID as string,
    });

    strictEqual(session.directory, '');
    strictEqual((await row(session.UUID))?.author, user.UUID);
  });

  it('answers a 400 for a size that is not a positive integer, opening nothing', async () => {
    const before = await sessions();

    for (const size of [0, -8, 1.5, Number.NaN, Infinity]) {
      const error = await refusal(() => createUploadSession({ name: 'tirion.txt', size }));
      strictEqual(error.status, 400, String(size));
    }

    strictEqual(await sessions(), before);
  });

  it('refuses a type outside uploads.types with typeNotAllowed at name', async () => {
    useLayers().add({
      path: '/uploads-sessions-create-types',
      input: { uploads: { types: ['image'] } },
    });
    try {
      const errors = await failure(() => createUploadSession({ name: 'grimoire.html', size: 3 }));

      deepStrictEqual(errors, {
        name: { key: 'uploads.errors.typeNotAllowed', params: { type: 'text/html' } },
      });
      ok(await createUploadSession({ name: 'grimoire.png', size: 3 }));
    } finally {
      useLayers().remove('/uploads-sessions-create-types');
    }
  });

  it('refuses a path past 768 bytes at directory', async () => {
    const directory = 'stormwind'.repeat(29).slice(0, 255);

    const errors = await failure(() =>
      createUploadSession({
        directory: `${directory}/${directory}/${directory}`,
        name: 'a.txt',
        size: 1,
      }),
    );

    deepStrictEqual(errors, {
      directory: { key: 'uploads.errors.pathTooLong', params: { max: 768 } },
    });
  });

  it('refuses a size past uploads.maxFileSize with fileTooLarge at size', async () => {
    const max = parseBytes('128mb');

    const errors = await failure(() =>
      createUploadSession({ name: 'deathwing.mp4', size: max + 1 }),
    );

    deepStrictEqual(errors, {
      size: { key: 'uploads.errors.fileTooLarge', params: { max: formatBytes(max) } },
    });
    ok(await createUploadSession({ name: 'deathwing.mp4', size: max }));
  });

  it('refuses a size that needs more parts than the storage holds', async () => {
    const parts = storage.parts!;
    parts.maxCount = 2;
    try {
      const errors = await failure(() =>
        createUploadSession({ name: 'onyxia.mp4', size: 2 * CHUNK_SIZE + 1 }),
      );

      deepStrictEqual(errors, {
        size: { key: 'uploads.errors.fileTooLarge', params: { max: formatBytes(2 * CHUNK_SIZE) } },
      });
      ok(await createUploadSession({ name: 'onyxia.mp4', size: 2 * CHUNK_SIZE }));
    } finally {
      parts.maxCount = Infinity;
    }
  });

  it('refuses an SVG past uploads.maxSVGSize, since completion sanitizes it whole', async () => {
    const max = parseBytes('2mb');

    const errors = await failure(() => createUploadSession({ name: 'sigil.svg', size: max + 1 }));

    deepStrictEqual(errors, {
      size: { key: 'uploads.errors.fileTooLarge', params: { max: formatBytes(max) } },
    });
    ok(await createUploadSession({ name: 'sigil.svg', size: max }));
  });

  it('answers a 501 on a storage without parts, opening nothing', async () => {
    const { parts } = storage;
    delete storage.parts;
    const before = await sessions();
    try {
      const error = await refusal(() => createUploadSession({ name: 'ragnaros.mp4', size: 5 }));

      strictEqual(error.status, 501);
      strictEqual(error.message, translate('uploads.errors.notResumable', { storage: 'memory' }));
      strictEqual(await sessions(), before);
    } finally {
      storage.parts = parts;
    }
  });

  it('deletes the row it opened when the storage cannot begin the write', async () => {
    const before = await sessions();
    storage.failNext('begin');

    await rejects(
      createUploadSession({ name: 'nerzhul.txt', size: 4 }),
      /memory storage begin failed/,
    );

    strictEqual(await sessions(), before);
  });

  it('expires a session on a whole millisecond under a fractional sessionMaxAge', async () => {
    useLayers().add({
      path: '/uploads-sessions-create-age',
      input: { uploads: { sessionMaxAge: 60_000.5 } },
    });
    try {
      const start = Date.now();

      const { expiresAt } = await createUploadSession({ name: 'sargeras.txt', size: 4 });

      ok(Number.isInteger(expiresAt), String(expiresAt));
      ok(expiresAt >= start + 60_001 && expiresAt <= Date.now() + 60_001);
    } finally {
      useLayers().remove('/uploads-sessions-create-age');
    }
  });

  it('sweeps the oldest expired sessions first, a few per create', async () => {
    const expired = [];
    for (let index = 0; index < 11; index++) {
      expired.push(await createUploadSession({ name: `ghoul-${index}.txt`, size: 4 }));
    }
    for (const [index, session] of expired.entries()) {
      await queryUntyped('UploadsSessions')
        .unscoped()
        .where({ UUID: session.UUID })
        .updateOrThrow({ expiresAt: Date.now() - DAY + index });
    }
    const tokens = await Promise.all(expired.map(async ({ UUID }) => (await row(UUID))?.token));

    const fresh = await createUploadSession({ name: 'lich-king.txt', size: 4 });

    const newest = expired.pop()!;
    for (const [index, session] of expired.entries()) {
      strictEqual(await row(session.UUID), undefined);
      strictEqual(storage.unfinished.has(tokens[index] as string), false);
    }
    ok(await row(newest.UUID));
    ok(await row(fresh.UUID));
    await createUploadSession({ name: 'kel-thuzad.txt', size: 4 });
    strictEqual(await row(newest.UUID), undefined);
  });

  it('opens a session without waiting on an expired one a request holds', async () => {
    const held = await createUploadSession({ name: 'maexxna.txt', size: 4 });
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: held.UUID })
      .updateOrThrow({ expiresAt: Date.now() - DAY });
    const release = await holdSession(held.UUID);
    try {
      notStrictEqual(
        await promptly(createUploadSession({ name: 'anubrekhan.txt', size: 4 })),
        'waited',
      );
      ok(await row(held.UUID));
    } finally {
      await release();
    }
    await abortUploadSession(held.UUID);
  });
});
