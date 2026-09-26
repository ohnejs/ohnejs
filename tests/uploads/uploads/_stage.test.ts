import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { journalStorage } from '../../../src/uploads/storage/journal.ts';
import { PEEK_SIZE } from '../../../src/uploads/uploads/_peek.ts';
import {
  checkHead,
  claimStaged,
  discardStaged,
  stageUpload,
  sweepStaged,
} from '../../../src/uploads/uploads/_stage.ts';
import { bytes, db, JPEG_HEAD, png, storage, stream, text } from '../_fixture.ts';

const stage = () => stageUpload(stream(bytes('hello')), { type: 'text/plain' });

const staged = () =>
  queryUntyped('UploadsJournal').where({ op: 'stage' }).pluck('from') as Promise<string[]>;

const MiB = 1024 * 1024;

function endlessSVG(): {
  body: ReadableStream<Uint8Array>;
  pulled: () => number;
  cancelled: Promise<unknown>;
} {
  const chunk = bytes('<rect/>'.repeat(9362));
  let pulled = 0;
  let cancel!: (reason: unknown) => void;
  const cancelled = new Promise<unknown>((resolve) => (cancel = resolve));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes('<svg xmlns="http://www.w3.org/2000/svg">'));
    },
    pull(controller) {
      pulled += chunk.byteLength;
      if (pulled > 32 * MiB) controller.close();
      else controller.enqueue(chunk);
    },
    cancel,
  });
  return { body, pulled: () => pulled, cancelled };
}

describe('staging', () => {
  it('journals the temp object until its row claims it', async () => {
    const { temp } = await stage();
    deepStrictEqual(await staged(), [temp]);

    await db.transaction(async (tx) => {
      await claimStaged(tx, temp);
      await journalStorage(tx, { op: 'delete', from: temp });
    }, 'immediate');
    deepStrictEqual(await staged(), []);
    await sweepStaged(Date.now() + 1);
  });

  it('keeps a fresh staged object another instance is still committing', async () => {
    const { temp } = await stage();

    await sweepStaged(Date.now() - 60_000);

    strictEqual(text(storage.objects.get(temp)), 'hello');
    await db.transaction((tx) => claimStaged(tx, temp), 'immediate');
    await discardStaged(temp);
  });

  it('fails the commit of a staged object a sweep claimed first', async () => {
    const { temp } = await stage();

    await sweepStaged(Date.now() + 1);

    strictEqual(storage.objects.has(temp), false);
    await rejects(
      db.transaction((tx) => claimStaged(tx, temp), 'immediate'),
      /was swept before its row committed/,
    );
    deepStrictEqual(await queryUntyped('UploadsJournal').findMany(), []);
  });

  it('keeps the entry when the discard cannot delete the object', async () => {
    const { temp } = await stage();
    storage.failNext('delete');

    await discardStaged(temp);

    ok(storage.objects.has(temp));
    deepStrictEqual(await staged(), [temp]);
    await sweepStaged(Date.now() + 1);
    strictEqual(storage.objects.has(temp), false);
    deepStrictEqual(await queryUntyped('UploadsJournal').findMany(), []);
  });

  it('hands the storage the disposition the type is served with', async () => {
    const write = mock.method(storage, 'write');
    try {
      await stageUpload(stream(bytes('<p>Lok&apos;tar ogar</p>')), { type: 'text/html' });
      await stage();
    } finally {
      write.mock.restore();
      await sweepStaged(Date.now() + 1);
    }

    deepStrictEqual(
      write.mock.calls.map(({ arguments: [, , meta] }) => meta.disposition),
      ['attachment', 'inline'],
    );
  });

  it('cancels the body of a head that contradicts its type, staging nothing', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(JPEG_HEAD);
      },
      pull(controller) {
        controller.enqueue(new Uint8Array(PEEK_SIZE));
      },
      cancel() {
        cancelled = true;
      },
    });

    await rejects(stageUpload(body, { type: 'image/png' }), isValidationError);

    ok(cancelled);
    deepStrictEqual(await staged(), []);
  });

  it('measures a raster image by its head', async () => {
    const { temp, width, height } = await stageUpload(stream(png(2, 3)), { type: 'image/png' });
    deepStrictEqual({ width, height }, { width: 2, height: 3 });
    await discardStaged(temp);
  });

  it('stops reading an SVG the moment it passes uploads.maxSVGSize, staging nothing', async () => {
    const { body, pulled, cancelled } = endlessSVG();
    let caught: unknown;
    await rejects(stageUpload(body, { type: 'image/svg+xml' }), (error: unknown) => {
      caught = error;
      return isValidationError(error);
    });
    deepStrictEqual((caught as { errors: unknown }).errors, {
      name: { key: 'uploads.errors.fileTooLarge', params: { max: '2mb' } },
    });
    ok(pulled() < 3 * MiB, `read ${pulled()} bytes`);
    strictEqual(await cancelled, caught);
    deepStrictEqual(await staged(), []);
    deepStrictEqual(
      [...storage.objects.keys()].filter((key) => key.startsWith('.tmp/')),
      [],
    );
  });

  it('refuses an SVG past a configured uploads.maxSVGSize', async () => {
    useLayers().add({ path: '/uploads-stage', input: { uploads: { maxSVGSize: '1kb' } } });
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(300)}</svg>`;
      let caught: unknown;
      await rejects(stageUpload(stream(bytes(svg)), { type: 'image/svg+xml' }), (error) => {
        caught = error;
        return isValidationError(error);
      });
      deepStrictEqual((caught as { errors: unknown }).errors, {
        name: { key: 'uploads.errors.fileTooLarge', params: { max: '1kb' } },
      });
      deepStrictEqual(await staged(), []);
    } finally {
      useLayers().remove('/uploads-stage');
    }
  });
});

describe('checkHead', () => {
  it('measures a raster image', () => {
    deepStrictEqual(checkHead(png(640, 480), 'image/png'), { width: 640, height: 480 });
  });

  it('leaves an SVG unmeasured, since only its sanitized markup counts', () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"/>');
    deepStrictEqual(checkHead(svg, 'image/svg+xml'), { width: null, height: null });
  });

  it('leaves bytes that are no image unmeasured', () => {
    deepStrictEqual(checkHead(bytes("Lok'tar ogar"), 'text/plain'), { width: null, height: null });
  });

  it('admits an image head it cannot sniff, unmeasured', () => {
    deepStrictEqual(checkHead(bytes('Thrall'), 'image/png'), { width: null, height: null });
  });

  it('refuses a head whose sniffed type contradicts the declared one', () => {
    let caught: unknown;
    throws(
      () => checkHead(JPEG_HEAD, 'image/png'),
      (error: unknown) => {
        caught = error;
        return isValidationError(error);
      },
    );
    deepStrictEqual((caught as { errors: unknown }).errors, {
      name: {
        key: 'uploads.errors.contentMismatch',
        params: { type: 'image/png', detected: 'image/jpeg' },
      },
    });
  });
});
