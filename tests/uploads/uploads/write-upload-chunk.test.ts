import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';

import type { StorageParts } from '../../../src/uploads/storage/adapter.ts';
import type { UploadSession } from '../../../src/uploads/uploads/types.ts';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { translate } from '../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { sessionTemp } from '../../../src/uploads/uploads/_session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { writeUploadChunk } from '../../../src/uploads/uploads/write-upload-chunk.ts';
import { digest } from '../../../src/utils/crypto/digest.ts';
import { createSHA256 } from '../../../src/utils/crypto/sha256.ts';
import { bytes, JPEG_HEAD, png, storage } from '../_fixture.ts';

const LAYER = '/uploads-sessions-write';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 32 } } });
after(() => useLayers().remove(LAYER));

const HORDE = bytes('Lok-tar ogar! Victory or death, for the Horde and for the Warchief!!');

/**
 * The hex SHA-256 of `source`, as `node:crypto` computes it.
 */
function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * Sets fields of the session row `uuid` directly, as a crash, a rival, or the clock would leave them.
 */
function tamper(uuid: string, fields: Record<string, unknown>): Promise<unknown> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).updateOrThrow(fields);
}

/**
 * Opens a session for `content` at the root under `name`.
 */
function open(name: string, content: Uint8Array): Promise<UploadSession> {
  return createUploadSession({ name, size: content.byteLength });
}

/**
 * The chunk of `content` that starts at `offset` on a 32-byte grid.
 */
function chunkAt(content: Uint8Array, offset: number): { offset: number; bytes: Uint8Array } {
  return { offset, bytes: content.subarray(offset, offset + 32) };
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

/**
 * Runs `run` while counting the storage's part writes, restoring `parts.write` afterwards.
 * `before` runs ahead of every part write.
 */
async function countingParts(
  run: (count: () => number) => Promise<void>,
  before: () => Promise<void> = async () => {},
): Promise<void> {
  const parts = storage.parts as StorageParts;
  const { write } = parts;
  let calls = 0;
  parts.write = async (...args) => {
    calls++;
    await before();
    return write(...args);
  };
  try {
    await run(() => calls);
  } finally {
    parts.write = write;
  }
}

describe('writeUploadChunk', () => {
  it('stores a chunk as the next part and advances the session past it', async () => {
    const session = await open('warsong.txt', HORDE);
    const first = chunkAt(HORDE, 0);

    const advanced = await writeUploadChunk(session.UUID, first);

    deepStrictEqual(advanced, { ...session, offset: 32 });
    const stored = (await row(session.UUID))!;
    deepStrictEqual(storage.unfinished.get(stored.token as string), [first.bytes]);
    deepStrictEqual(JSON.parse(stored.receipts as string), [digest('md5', first.bytes).toHex()]);
    strictEqual(createSHA256(stored.hashState as string).digest(), sha256(first.bytes));
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('answers a 400 for a chunk off the grid, storing nothing', async () => {
    const session = await open('frostwolf.txt', HORDE);
    const off = [
      { offset: 5, bytes: HORDE.subarray(5, 37) },
      { offset: -32, bytes: HORDE.subarray(0, 32) },
      { offset: 1.5, bytes: HORDE.subarray(0, 32) },
      { offset: Number.NaN, bytes: HORDE.subarray(0, 32) },
      { offset: 96, bytes: HORDE.subarray(0, 32) },
      { offset: 0, bytes: HORDE.subarray(0, 31) },
      { offset: 0, bytes: HORDE.subarray(0, 33) },
      { offset: 64, bytes: HORDE.subarray(32, 64) },
    ];

    await countingParts(async (count) => {
      for (const chunk of off) {
        const error = await refusal(() => writeUploadChunk(session.UUID, chunk));
        strictEqual(error.status, 400, `${chunk.offset}+${chunk.bytes.byteLength}`);
      }
      strictEqual(count(), 0);
    });
    strictEqual((await row(session.UUID))?.offset, 0);
  });

  it('answers a replayed chunk with a 409 carrying the session, storing nothing', async () => {
    const session = await open('grommash.txt', HORDE);
    const advanced = await writeUploadChunk(session.UUID, chunkAt(HORDE, 0));

    await countingParts(async (count) => {
      const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 0)));

      strictEqual(error.status, 409);
      deepStrictEqual(error.data, advanced);
      strictEqual(count(), 0);
    });
  });

  it('answers a chunk ahead of the offset with a 409', async () => {
    const session = await open('durotan.txt', HORDE);

    const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 64)));

    strictEqual(error.status, 409);
    deepStrictEqual(error.data, session);
  });

  it('answers a 409 once every chunk is in', async () => {
    const session = await open('draka.txt', HORDE);
    for (const offset of [0, 32, 64]) await writeUploadChunk(session.UUID, chunkAt(HORDE, offset));

    const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 64)));

    strictEqual(error.status, 409);
    strictEqual((error.data as UploadSession).offset, HORDE.byteLength);
  });

  it('answers a sealed session with a 409', async () => {
    const session = await open('orgrim.txt', HORDE);
    await tamper(session.UUID, { token: null, offset: HORDE.byteLength });

    const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 0)));

    strictEqual(error.status, 409);
  });

  it('advances the midstate exactly once, however often a chunk is replayed', async () => {
    const session = await open('saurfang.txt', HORDE);

    for (const offset of [0, 32, 64]) {
      await writeUploadChunk(session.UUID, chunkAt(HORDE, offset));
      await rejects(writeUploadChunk(session.UUID, chunkAt(HORDE, offset)));
    }

    const { hashState } = (await row(session.UUID))!;
    strictEqual(createSHA256(hashState as string).digest(), sha256(HORDE));
  });

  it('lets one of two concurrent writes at one offset through, storing one part', async () => {
    const session = await open('nazgrel.txt', HORDE);

    await countingParts(async (count) => {
      const outcomes = await Promise.allSettled([
        writeUploadChunk(session.UUID, chunkAt(HORDE, 0)),
        writeUploadChunk(session.UUID, chunkAt(HORDE, 0)),
      ]);

      const statuses = outcomes.map((outcome) =>
        outcome.status === 'fulfilled' ? 200 : (outcome.reason as HTTPError).status,
      );
      deepStrictEqual(statuses.sort(), [200, 409]);
      strictEqual(count(), 1);
    });
    const stored = (await row(session.UUID))!;
    strictEqual(stored.offset, 32);
    strictEqual(JSON.parse(stored.receipts as string).length, 1);
    strictEqual(createSHA256(stored.hashState as string).digest(), sha256(HORDE.subarray(0, 32)));
  });

  it('catches a rival that took the lock over with the compare-and-set', async () => {
    const session = await open('rehgar.txt', HORDE);
    const rival = createSHA256();
    rival.update(bytes('the rival wrote this chunk first'));

    await countingParts(
      async () => {
        const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 0)));

        strictEqual(error.status, 409);
        strictEqual((error.data as UploadSession).offset, 32);
      },
      async () => {
        await tamper(session.UUID, { offset: 32, hashState: rival.state() });
      },
    );
    strictEqual((await row(session.UUID))?.hashState, rival.state());
  });

  it('keeps the session as it was when the part write fails, so the chunk can be sent again', async () => {
    const session = await open('garrosh.txt', HORDE);
    const before = await row(session.UUID);
    storage.failNext('part');

    await rejects(writeUploadChunk(session.UUID, chunkAt(HORDE, 0)), /memory storage part failed/);

    deepStrictEqual(await row(session.UUID), before);
    strictEqual((await writeUploadChunk(session.UUID, chunkAt(HORDE, 0))).offset, 32);
  });

  it('measures an image from its first chunk', async () => {
    const image = png(2, 3);
    const session = await open('banner.png', image);

    await writeUploadChunk(session.UUID, chunkAt(image, 0));
    await writeUploadChunk(session.UUID, chunkAt(image, 32));

    const stored = (await row(session.UUID))!;
    deepStrictEqual({ width: stored.width, height: stored.height }, { width: 2, height: 3 });
  });

  it('discards the session when the first chunk contradicts its type', async () => {
    const session = await open('portrait.png', JPEG_HEAD);
    const { token } = (await row(session.UUID))!;

    let caught: unknown;
    await rejects(writeUploadChunk(session.UUID, { offset: 0, bytes: JPEG_HEAD }), (error) => {
      caught = error;
      return isValidationError(error);
    });

    deepStrictEqual((caught as { errors: unknown }).errors, {
      name: {
        key: 'uploads.errors.contentMismatch',
        params: { type: 'image/png', detected: 'image/jpeg' },
      },
    });
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token as string), false);
  });

  it('discards the session when a first chunk at the smallest chunk size contradicts its type', async () => {
    useLayers().add({
      path: '/uploads-sessions-write-floor',
      input: { uploads: { chunkSize: '64kb' } },
    });
    try {
      const disguised = new Uint8Array(70_000).fill(0x20);
      disguised.set(
        bytes(
          '<!-- carved by the Bronzebeard clan --><svg xmlns="http://www.w3.org/2000/svg"></svg>',
        ),
      );
      const session = await open('totem.png', disguised);
      const { token } = (await row(session.UUID))!;

      let caught: unknown;
      const first = { offset: 0, bytes: disguised.subarray(0, 65_536) };
      await rejects(writeUploadChunk(session.UUID, first), (error) => {
        caught = error;
        return isValidationError(error);
      });

      deepStrictEqual((caught as { errors: unknown }).errors, {
        name: {
          key: 'uploads.errors.contentMismatch',
          params: { type: 'image/png', detected: 'image/svg+xml' },
        },
      });
      strictEqual(await row(session.UUID), undefined);
      strictEqual(storage.unfinished.has(token as string), false);
    } finally {
      useLayers().remove('/uploads-sessions-write-floor');
    }
  });

  it('discards an expired session and answers sessionExpired', async () => {
    const session = await open('zuljin.txt', HORDE);
    const { token } = (await row(session.UUID))!;
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 0)));

    strictEqual(error.status, 404);
    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token as string), false);
  });

  it('discards a session whose handle a crash lost and answers sessionExpired', async () => {
    const session = await open('voljin.txt', HORDE);
    await tamper(session.UUID, { token: null });

    const error = await refusal(() => writeUploadChunk(session.UUID, chunkAt(HORDE, 0)));

    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
  });

  it('answers the plain 404 for a session another author created', async () => {
    const thrall = await queryUntyped('Users').createOrThrow({
      email: 'thrall@orgrimmar.test',
      password: 'pw-123456',
      roles: [],
    });
    const session = await createUploadSession({
      name: 'doomhammer.txt',
      size: 5,
      author: thrall.UUID as string,
    });

    const error = await refusal(() =>
      writeUploadChunk(session.UUID, { offset: 0, bytes: bytes('Hammr') }, { author: 'cairne' }),
    );

    strictEqual(error.status, 404);
    strictEqual(error.message, translate('api.http.notFound'));
    ok(await row(session.UUID));
  });
});
