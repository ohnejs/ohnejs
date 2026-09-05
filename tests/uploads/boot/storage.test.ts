import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import '../../../src/uploads/boot/storage.ts';
import { useStorages } from '../../../src/uploads/storage/use-storages.ts';
import { isUndefined } from '../../../src/utils/index.ts';

describe('boot/storage', () => {
  it('registers the fs backend, which keeps objects under the given root', async () => {
    const factory = useStorages().get('fs');
    ok(!isUndefined(factory));
    const root = mkdtempSync(join(tmpdir(), 'ohne-boot-storage-'));
    try {
      const storage = factory(root);
      const body = ReadableStream.from([new TextEncoder().encode('sunset')]);
      await storage.write('photos/sunset.jpg', body, { type: 'image/jpeg' });
      strictEqual(readFileSync(join(root, 'photos/sunset.jpg'), 'utf8'), 'sunset');
      deepStrictEqual(await storage.stat('photos/sunset.jpg'), { size: 6 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
