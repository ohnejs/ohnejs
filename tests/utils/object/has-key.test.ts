import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hasKey } from '../../../src/utils/index.ts';

describe('hasKey', () => {
  it('returns true when the key exists', () => {
    strictEqual(hasKey({ a: 1 }, 'a'), true);
  });

  it('returns true when the key has an undefined value', () => {
    strictEqual(hasKey({ a: undefined }, 'a'), true);
  });

  it('returns false when the key does not exist', () => {
    strictEqual(hasKey({}, 'a'), false);
    strictEqual(hasKey({ a: 1 }, 'b'), false);
  });

  it('ignores inherited properties', () => {
    const proto = { inherited: true };
    const obj = Object.create(proto);
    strictEqual(hasKey(obj, 'inherited'), false);
  });

  it('rejects Object.prototype names on a plain object', () => {
    strictEqual(hasKey({}, 'toString'), false);
    strictEqual(hasKey({}, 'constructor'), false);
    strictEqual(hasKey({}, 'hasOwnProperty'), false);
  });

  it('supports symbol keys', () => {
    const sym = Symbol('s');
    strictEqual(hasKey({ [sym]: 1 }, sym), true);
    strictEqual(hasKey({}, sym), false);
  });

  it('narrows the type so the key is accessible after the check', () => {
    const obj: object = { dir: '/tmp' };
    if (hasKey(obj, 'dir')) {
      const v: unknown = obj.dir;
      strictEqual(v, '/tmp');
    }
  });

  it('preserves the value type when the key is in the index signature', () => {
    const obj = { a: 'hello' } as Record<string, string>;
    if (hasKey(obj, 'a')) {
      const v: string = obj.a;
      strictEqual(v, 'hello');
    }
  });
});
