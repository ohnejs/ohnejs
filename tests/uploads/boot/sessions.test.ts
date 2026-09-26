import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../../../src/uploads/boot/sessions.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { parseBytes } from '../../../src/utils/index.ts';
import { storage } from '../_fixture.ts';

const synced = () => applyHook('schema:synced', { deletions: [], warnings: [] });

/**
 * Runs `run` with `uploads.chunkSize` at `chunkSize` and the storage's smallest part at `minSize`.
 */
async function withSizes(
  chunkSize: string,
  minSize: string,
  run: () => Promise<unknown>,
): Promise<void> {
  const parts = storage.parts!;
  const original = parts.minSize;
  parts.minSize = parseBytes(minSize);
  useLayers().add({ path: '/boot-sessions', input: { uploads: { chunkSize } } });
  try {
    await run();
  } finally {
    useLayers().remove('/boot-sessions');
    parts.minSize = original;
  }
}

describe('the sessions boot file', () => {
  it('refuses a chunk size below the smallest part the storage stores', async () => {
    await withSizes('1mb', '5mb', async () => {
      await rejects(synced(), (error) => {
        ok(isOhneError(error));
        strictEqual(error.title, '`uploads.chunkSize` is too small for the `memory` storage');
        deepStrictEqual(error.body, [
          'Each chunk is stored as one part, and `memory` needs every part but the last to hold `5mb` or more.',
          'You set `1mb`.',
          '',
          'Raise `uploads.chunkSize` to `5mb` or more.',
        ]);
        return true;
      });
    });
  });

  it('accepts a chunk size at the smallest part', async () => {
    await withSizes('5mb', '5mb', synced);
  });

  it('accepts a chunk size under the smallest part on a storage without parts', async () => {
    await withSizes('1mb', '5mb', async () => {
      const { parts } = storage;
      delete storage.parts;
      try {
        await synced();
      } finally {
        storage.parts = parts;
      }
    });
  });
});
