import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hasKeys } from '../../../src/utils/index.ts';

describe('hasKeys', () => {
  it('returns true when every listed key exists', () => {
    strictEqual(hasKeys({ a: 1, b: 2 }, ['a', 'b']), true);
  });

  it('returns false when any listed key is missing', () => {
    strictEqual(hasKeys({ a: 1 }, ['a', 'b']), false);
  });

  it('returns true for an empty key list (vacuous)', () => {
    strictEqual(hasKeys({}, []), true);
  });

  it('returns true when a key has an undefined value', () => {
    strictEqual(hasKeys({ a: undefined, b: 2 }, ['a', 'b']), true);
  });

  it('ignores inherited properties', () => {
    const proto = { inherited: true };
    const obj = Object.create(proto);
    obj.own = 1;
    strictEqual(hasKeys(obj, ['inherited']), false);
    strictEqual(hasKeys(obj, ['own', 'inherited']), false);
  });

  it('rejects Object.prototype names on a plain object', () => {
    strictEqual(hasKeys({ a: 1 }, ['a', 'toString']), false);
  });

  it('supports symbol keys', () => {
    const sym = Symbol('s');
    strictEqual(hasKeys({ [sym]: 1, a: 2 }, [sym, 'a']), true);
    strictEqual(hasKeys({ a: 2 }, [sym, 'a']), false);
  });

  it('narrows the type so all listed keys are accessible after the check', () => {
    const obj: object = { id: 1, name: 'a' };
    if (hasKeys(obj, ['id', 'name'])) {
      const id: unknown = obj.id;
      const name: unknown = obj.name;
      strictEqual(id, 1);
      strictEqual(name, 'a');
    }
  });

  it('preserves the value type when the keys are in the index signature', () => {
    const obj = { a: 'x', b: 'y' } as Record<string, string>;
    if (hasKeys(obj, ['a', 'b'])) {
      const a: string = obj.a;
      const b: string = obj.b;
      strictEqual(a, 'x');
      strictEqual(b, 'y');
    }
  });
});
