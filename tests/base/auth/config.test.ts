import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useAuthConfig } from '../../../src/base/auth/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

useLayers().add({ path: '/auth-config-test', input: { auth: { password: { cost: 1024 } } } });

describe('useAuthConfig', () => {
  it('fills unset fields from the defaults, deep-merging a partial password override', () => {
    const config = useAuthConfig();
    strictEqual(config.sessionMaxAge, '30d');
    strictEqual(config.transientSessionMaxAge, '1d');
    strictEqual(config.cookieName, 'session');
    strictEqual(config.password.cost, 1024);
    strictEqual(config.password.blockSize, 8);
    strictEqual(config.password.parallelization, 1);
  });
});
