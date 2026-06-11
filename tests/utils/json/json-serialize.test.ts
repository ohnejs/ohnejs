import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonSerialize } from '../../../src/utils/index.ts';

describe('jsonSerialize', () => {
  it('sorts plain-object keys', () => {
    strictEqual(jsonSerialize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  });

  it('sorts keys recursively', () => {
    strictEqual(jsonSerialize({ z: { b: 2, a: 1 } }), '{"z":{"a":1,"b":2}}');
  });

  it('preserves array order', () => {
    strictEqual(jsonSerialize([3, 1, 2]), '[3,1,2]');
  });

  it('sorts keys inside arrays of objects', () => {
    strictEqual(jsonSerialize([{ b: 2, a: 1 }]), '[{"a":1,"b":2}]');
  });

  it('serializes primitives', () => {
    strictEqual(jsonSerialize(null), 'null');
    strictEqual(jsonSerialize('hi'), '"hi"');
    strictEqual(jsonSerialize(42), '42');
    strictEqual(jsonSerialize(true), 'true');
  });

  it('leaves class instances alone (Date hits toJSON)', () => {
    strictEqual(jsonSerialize(new Date('2026-01-01T00:00:00.000Z')), '"2026-01-01T00:00:00.000Z"');
  });

  it('applies a function replacer over the sorted shape', () => {
    const out = jsonSerialize({ b: 2, a: 1 }, (_k, v) => (typeof v === 'number' ? v * 10 : v));
    strictEqual(out, '{"a":10,"b":20}');
  });

  it('applies an array allow-list replacer', () => {
    strictEqual(jsonSerialize({ b: 2, a: 1, c: 3 }, ['a', 'b']), '{"a":1,"b":2}');
  });

  it('sorts before the replacer sees keys', () => {
    const order: string[] = [];
    jsonSerialize({ b: 2, a: 1 }, (k, v) => {
      if (k) order.push(k);
      return v;
    });
    strictEqual(order.join(','), 'a,b');
  });
});
