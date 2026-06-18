import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonClone } from '../../../src/utils/index.ts';

describe('jsonClone', () => {
  it('returns primitives unchanged', () => {
    strictEqual(jsonClone(1), 1);
    strictEqual(jsonClone('a'), 'a');
    strictEqual(jsonClone(true), true);
    strictEqual(jsonClone(null), null);
  });

  it('clones a flat object', () => {
    const o = { a: 1, b: 'two', c: true };
    const c = jsonClone(o);
    deepStrictEqual(c, o);
    notStrictEqual(c, o);
  });

  it('clones nested objects deeply', () => {
    const o = { a: { b: { c: 1 } } };
    const c = jsonClone(o);
    deepStrictEqual(c, o);
    notStrictEqual(c.a, o.a);
    notStrictEqual(c.a.b, o.a.b);
  });

  it('clones arrays deeply', () => {
    const o = [{ x: 1 }, [2, 3]];
    const c = jsonClone(o);
    deepStrictEqual(c, o);
    notStrictEqual(c, o);
    notStrictEqual(c[0], o[0]);
    notStrictEqual(c[1], o[1]);
  });

  it('mutating the clone does not affect the original', () => {
    const o = { a: [1, 2], b: { c: 'hello' } };
    const c = jsonClone(o);
    c.a.push(3);
    c.b.c = 'changed';
    deepStrictEqual(o, { a: [1, 2], b: { c: 'hello' } });
  });
});
