import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { sessionLifetime } from '../../../src/base/auth/_lifetime.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { parseDuration } from '../../../src/utils/index.ts';

const LAYER = '/lifetime-test';

function configureAuth(sessionMaxAge: string, transientSessionMaxAge: string): void {
  useLayers().add({ path: LAYER, input: { auth: { sessionMaxAge, transientSessionMaxAge } } });
}

describe('sessionLifetime', () => {
  afterEach(() => {
    useLayers().remove(LAYER);
  });

  it('gives a remembered session the whole `sessionMaxAge`', () => {
    configureAuth('30d', '1d');
    strictEqual(sessionLifetime(true), parseDuration('30d'));
  });

  it('gives a session without remember me the shorter `transientSessionMaxAge`', () => {
    configureAuth('30d', '1d');
    strictEqual(sessionLifetime(false), parseDuration('1d'));
  });

  it('caps a `transientSessionMaxAge` set above `sessionMaxAge` at that ceiling', () => {
    configureAuth('2h', '7d');
    strictEqual(sessionLifetime(false), parseDuration('2h'));
  });
});
