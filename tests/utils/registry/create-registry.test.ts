import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createRegistry } from '../../../src/utils/index.ts';

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('createRegistry', () => {
  it('starts empty', () => {
    const r = createRegistry<number>();
    strictEqual(r.size, 0);
    strictEqual(r.has('a'), false);
    strictEqual(r.get('a'), undefined);
    deepStrictEqual(r.keys(), []);
    deepStrictEqual(r.all(), nullObj({}));
  });

  it('registers and retrieves values', () => {
    const r = createRegistry<number>();
    r.register('a', 1);
    r.register('b', 2);
    strictEqual(r.get('a'), 1);
    strictEqual(r.get('b'), 2);
    strictEqual(r.has('a'), true);
    strictEqual(r.size, 2);
    deepStrictEqual(r.keys(), ['a', 'b']);
  });

  it('replaces on collision when no merger is configured', () => {
    const r = createRegistry<number>();
    r.register('a', 1);
    r.register('a', 2);
    r.register('a', 3);
    strictEqual(r.get('a'), 3);
    strictEqual(r.size, 1);
  });

  it('folds via the merger on collision', () => {
    const r = createRegistry<number>({ merge: (existing, incoming) => existing + incoming });
    r.register('a', 1);
    r.register('a', 2);
    r.register('a', 3);
    strictEqual(r.get('a'), 6);
  });

  it('passes (existing, incoming) to the merger in that order', () => {
    const calls: [string, string][] = [];
    const r = createRegistry<string>({
      merge: (existing, incoming) => {
        calls.push([existing, incoming]);
        return existing + incoming;
      },
    });
    r.register('a', 'x');
    r.register('a', 'y');
    r.register('a', 'z');
    deepStrictEqual(calls, [
      ['x', 'y'],
      ['xy', 'z'],
    ]);
  });

  it('does not invoke the merger on the first register', () => {
    let calls = 0;
    const r = createRegistry<number>({
      merge: (a, b) => {
        calls++;
        return a + b;
      },
    });
    r.register('a', 1);
    strictEqual(calls, 0);
    strictEqual(r.get('a'), 1);
  });

  it('does not invoke the merger after delete', () => {
    let calls = 0;
    const r = createRegistry<number>({
      merge: (a, b) => {
        calls++;
        return a + b;
      },
    });
    r.register('a', 1);
    r.delete('a');
    r.register('a', 2);
    strictEqual(calls, 0);
    strictEqual(r.get('a'), 2);
  });

  it('delete returns whether the key was present', () => {
    const r = createRegistry<number>();
    r.register('a', 1);
    strictEqual(r.delete('a'), true);
    strictEqual(r.delete('a'), false);
    strictEqual(r.has('a'), false);
    strictEqual(r.size, 0);
  });

  it('clear empties the registry', () => {
    const r = createRegistry<number>();
    r.register('a', 1);
    r.register('b', 2);
    r.clear();
    strictEqual(r.size, 0);
    deepStrictEqual(r.keys(), []);
    deepStrictEqual(r.all(), nullObj({}));
  });

  it('all returns a fresh null-prototype object each call', () => {
    const r = createRegistry<number>();
    r.register('a', 1);
    r.register('b', 2);
    const first = r.all();
    const second = r.all();
    deepStrictEqual(first, nullObj({ a: 1, b: 2 }));
    strictEqual(first === second, false);
    strictEqual(Object.getPrototypeOf(first), null);
    first.a = 99;
    strictEqual(r.get('a'), 1);
  });

  it('keys reflects insertion order', () => {
    const r = createRegistry<number>();
    r.register('z', 1);
    r.register('a', 2);
    r.register('m', 3);
    deepStrictEqual(r.keys(), ['z', 'a', 'm']);
  });

  it('size reflects the live count', () => {
    const r = createRegistry<number>();
    strictEqual(r.size, 0);
    r.register('a', 1);
    strictEqual(r.size, 1);
    r.register('a', 2);
    strictEqual(r.size, 1);
    r.register('b', 3);
    strictEqual(r.size, 2);
    r.delete('a');
    strictEqual(r.size, 1);
    r.clear();
    strictEqual(r.size, 0);
  });

  it('handles prototype-pollution keys safely', () => {
    const r = createRegistry<number>();
    r.register('__proto__', 1);
    r.register('constructor', 2);
    r.register('prototype', 3);
    strictEqual(r.get('__proto__'), 1);
    strictEqual(r.get('constructor'), 2);
    strictEqual(r.get('prototype'), 3);
    const out = r.all();
    strictEqual(Object.getPrototypeOf(out), null);
    strictEqual(out['__proto__'], 1);
    strictEqual(out['constructor'], 2);
    strictEqual(out['prototype'], 3);
  });

  it('independent registries do not share state', () => {
    const a = createRegistry<number>();
    const b = createRegistry<number>();
    a.register('x', 1);
    b.register('x', 2);
    strictEqual(a.get('x'), 1);
    strictEqual(b.get('x'), 2);
  });

  it('stores references, not clones', () => {
    interface Box {
      value: number;
    }
    const r = createRegistry<Box>();
    const box: Box = { value: 1 };
    r.register('b', box);
    strictEqual(r.get('b'), box);
  });
});
