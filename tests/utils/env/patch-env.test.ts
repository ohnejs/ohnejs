import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { patchEnv } from '../../../src/utils/env/index.ts';

describe('patchEnv', () => {
  it('adds keys that are missing from the target', () => {
    const target: NodeJS.ProcessEnv = {};
    patchEnv({ FOO: 'a', BAR: 'b' }, target);
    deepStrictEqual(target, { FOO: 'a', BAR: 'b' });
  });

  it('overrides keys that already exist', () => {
    const target: NodeJS.ProcessEnv = { FOO: 'old' };
    patchEnv({ FOO: 'new', BAR: 'added' }, target);
    deepStrictEqual(target, { FOO: 'new', BAR: 'added' });
  });

  it('mutates the target in place', () => {
    const target: NodeJS.ProcessEnv = {};
    const ret = patchEnv({ FOO: 'a' }, target);
    strictEqual(ret, undefined);
    strictEqual(target.FOO, 'a');
  });

  it('does nothing for an empty source', () => {
    const target: NodeJS.ProcessEnv = { FOO: 'a' };
    patchEnv({}, target);
    deepStrictEqual(target, { FOO: 'a' });
  });

  it('patches `process.env` by default', () => {
    const key = '__OHNE_PATCH_ENV_TEST__';
    delete process.env[key];
    try {
      patchEnv({ [key]: 'hello' });
      strictEqual(process.env[key], 'hello');

      patchEnv({ [key]: 'overwritten' });
      strictEqual(process.env[key], 'overwritten');
    } finally {
      delete process.env[key];
    }
  });
});
