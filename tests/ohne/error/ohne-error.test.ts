import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError, ohneError } from '../../../src/ohne/error/ohne-error.ts';

describe('ohneError', () => {
  it('builds a bare-message error with no title or path', () => {
    const error = ohneError('Project has no routes');

    ok(error instanceof Error);
    strictEqual(error.message, 'Project has no routes');
    strictEqual(error.title, undefined);
    strictEqual(error.body, undefined);
    strictEqual(error.path, undefined);
  });

  it('builds a rich error from a title, body, and path', () => {
    const error = ohneError({
      title: 'Invalid `port`',
      body: ['`port` must be 0-65535.', 'You set `99999`.'],
      path: 'ohne.config.ts:3:5',
    });

    strictEqual(error.message, 'Invalid `port`');
    strictEqual(error.title, 'Invalid `port`');
    deepStrictEqual(error.body, ['`port` must be 0-65535.', 'You set `99999`.']);
    strictEqual(error.path, 'ohne.config.ts:3:5');
  });

  it('survives throw and catch as a branded error', () => {
    try {
      throw ohneError('boom');
    } catch (error) {
      ok(isOhneError(error));
      strictEqual((error as Error).message, 'boom');
    }
  });
});

describe('isOhneError', () => {
  it('is true only for an ohneError', () => {
    strictEqual(isOhneError(ohneError('x')), true);
    strictEqual(isOhneError(new Error('x')), false);
    strictEqual(isOhneError('x'), false);
    strictEqual(isOhneError(null), false);
    strictEqual(isOhneError({ title: 'x' }), false);
  });
});
