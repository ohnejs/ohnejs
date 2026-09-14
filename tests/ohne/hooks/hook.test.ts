import { strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { hook, useHooks } from '../../../src/ohne/index.ts';

declare module 'ohnejs' {
  interface Hooks {
    greet: () => void;
  }
}

describe('hook', () => {
  beforeEach(() => {
    useHooks().clear();
  });

  it('registers a callback under its name', () => {
    const fn = () => undefined;
    hook('greet', fn);
    strictEqual(useHooks().get('greet')?.[0], fn);
  });

  it('appends callbacks in registration order', () => {
    const a = () => undefined;
    const b = () => undefined;
    hook('greet', a);
    hook('greet', b);
    strictEqual(useHooks().get('greet')?.length, 2);
    strictEqual(useHooks().get('greet')?.[1], b);
  });
});
