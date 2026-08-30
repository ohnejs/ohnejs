import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { deepOmit } from '../../../src/utils/index.ts';

describe('deepOmit', () => {
  it('removes the listed keys at the top level', () => {
    deepStrictEqual(deepOmit({ id: 1, name: 'a' }, ['id']), { name: 'a' });
  });

  it('removes the listed keys at every depth', () => {
    deepStrictEqual(deepOmit({ id: 1, child: { id: 2, rows: [{ id: 3, name: 'a' }] } }, ['id']), {
      child: { rows: [{ name: 'a' }] },
    });
  });

  it('maps arrays element-wise', () => {
    deepStrictEqual(deepOmit([{ a: 1, b: 2 }, { b: 3 }], ['b']), [{ a: 1 }, {}]);
  });

  it('passes primitives and null through', () => {
    strictEqual(deepOmit('a', ['a']), 'a');
    strictEqual(deepOmit(null, ['a']), null);
    strictEqual(deepOmit(7, ['a']), 7);
  });

  it('does not mutate the input', () => {
    const input = { id: 1, child: { id: 2 } };
    deepOmit(input, ['id']);
    deepStrictEqual(input, { id: 1, child: { id: 2 } });
  });

  it('returns a new object reference', () => {
    const input = { a: 1 };
    notStrictEqual(deepOmit(input, []), input);
  });

  it('skips an own `__proto__` key', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    const result = deepOmit(input, []) as Record<string, unknown>;
    strictEqual(Object.getPrototypeOf(result), Object.prototype);
    strictEqual(result.polluted, undefined);
    strictEqual(result.a, 1);
  });
});
