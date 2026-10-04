import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import {
  loginDefaults,
  setLoginDefaults,
} from '../../../../src/base/dashboard/components/login-defaults.ts';
import { effect } from '../../../../src/utils/index.ts';

describe('setLoginDefaults', () => {
  afterEach(() => setLoginDefaults(null));

  it('starts with no defaults', () => {
    strictEqual(loginDefaults(), null);
  });

  it('answers the values it was given', () => {
    setLoginDefaults({ email: 'demo@example.com', password: 'demo' });
    deepStrictEqual(loginDefaults(), { email: 'demo@example.com', password: 'demo' });
  });

  it('clears the values with `null`', () => {
    setLoginDefaults({ email: 'demo@example.com' });
    setLoginDefaults(null);
    strictEqual(loginDefaults(), null);
  });

  it('re-runs an effect when the same values are set again', () => {
    const editor = { email: 'editor@example.com' };
    let runs = 0;
    const stop = effect(() => {
      loginDefaults();
      runs += 1;
    });
    setLoginDefaults(editor);
    setLoginDefaults(editor);
    stop();
    strictEqual(runs, 3);
  });

  it('re-runs an effect that read them', () => {
    const seen: (string | undefined)[] = [];
    const stop = effect(() => void seen.push(loginDefaults()?.email));
    setLoginDefaults({ email: 'admin@example.com' });
    setLoginDefaults({ email: 'editor@example.com' });
    setLoginDefaults(null);
    stop();
    deepStrictEqual(seen, [undefined, 'admin@example.com', 'editor@example.com', undefined]);
  });
});
