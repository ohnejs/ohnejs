import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { journalStorage } from '../../../src/uploads/storage/journal.ts';
import {
  claimStaged,
  discardStaged,
  stageUpload,
  sweepStaged,
} from '../../../src/uploads/uploads/_stage.ts';
import { bytes, db, storage, stream, text } from '../_fixture.ts';

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
