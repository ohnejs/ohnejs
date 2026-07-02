import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { createSetTarget } from '../../../../src/ohne/dev/targets/set-target.ts';
import { useLayers } from '../../../../src/ohne/index.ts';

const noFiles = async (): Promise<Set<string>> => new Set();
const noop = async (): Promise<string | null> => null;

describe('createSetTarget', () => {
  afterEach(() => useLayers().clear());

  it('is affected only by paths inside a layer dir, including nested ones', () => {
    useLayers().add({ path: '/app', input: { dirs: { api: 'routes' } } });
    const target = createSetTarget('routes', '/app', 'api', noFiles, noop);

    strictEqual(target.affectedBy('/app/routes/x.ts'), true);
    strictEqual(target.affectedBy('/app/routes/nested/y.ts'), true);
    strictEqual(target.affectedBy('/app/middleware/x.ts'), false);
  });

  it('falls back to the default dir name', () => {
    useLayers().add({ path: '/app', input: {} });
    const target = createSetTarget('routes', '/app', 'api', noFiles, noop);

    strictEqual(target.affectedBy('/app/api/x.ts'), true);
  });

  it('writes only when the file set changes, and invalidate forces a write', async () => {
    useLayers().add({ path: '/app', input: {} });
    let files = new Set(['a']);
    let writes = 0;
    const target = createSetTarget(
      'routes',
      '/app',
      'api',
      async () => new Set(files),
      async () => {
        writes++;
        return `/out/${writes}.ts`;
      },
    );

    deepStrictEqual(await target.regen(), ['/out/1.ts']);
    strictEqual(writes, 1);

    deepStrictEqual(await target.regen(), []);
    strictEqual(writes, 1);

    files = new Set(['a', 'b']);
    await target.regen();
    strictEqual(writes, 2);

    target.invalidate();
    await target.regen();
    strictEqual(writes, 3);
  });
});
