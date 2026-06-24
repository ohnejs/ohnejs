import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  composeCodecs,
  type JSONCodec,
  jsonDeserialize,
  jsonSerialize,
} from '../../../src/utils/index.ts';

const dateCodec: JSONCodec<Date> = {
  name: 'date',
  test: (v): v is Date => v instanceof Date,
  encode: (d) => d.toISOString(),
  decode: (raw) => new Date(raw as string),
};

const bigIntCodec: JSONCodec<bigint> = {
  name: 'bigint',
  test: (v): v is bigint => typeof v === 'bigint',
  encode: (n) => n.toString(),
  decode: (raw) => BigInt(raw as string),
};

const mapCodec: JSONCodec<Map<unknown, unknown>> = {
  name: 'map',
  test: (v): v is Map<unknown, unknown> => v instanceof Map,
  encode: (m) => [...m.entries()],
  decode: (raw) => new Map(raw as [unknown, unknown][]),
};

describe('composeCodecs', () => {
  it('roundtrips a Date through serialize/deserialize', () => {
    const { encode, reviver } = composeCodecs(dateCodec);
    const date = new Date('2026-06-11T00:00:00.000Z');

    const text = jsonSerialize(encode({ at: date }));
    strictEqual(text, '{"at":{"$date":"2026-06-11T00:00:00.000Z"}}');

    const back = jsonDeserialize<{ at: Date }>(text, reviver);
    ok(back.at instanceof Date);
    strictEqual(back.at.toISOString(), date.toISOString());
  });

  it('roundtrips a BigInt', () => {
    const { encode, reviver } = composeCodecs(bigIntCodec);
    const text = jsonSerialize(encode({ n: 9007199254740993n }));
    strictEqual(text, '{"n":{"$bigint":"9007199254740993"}}');

    const back = jsonDeserialize<{ n: bigint }>(text, reviver);
    strictEqual(back.n, 9007199254740993n);
  });

  it('roundtrips a Map with Date values (nested codecs)', () => {
    const { encode, reviver } = composeCodecs(dateCodec, mapCodec);
    const date = new Date('2026-06-11T00:00:00.000Z');
    const map = new Map<string, Date>([['a', date]]);

    const text = jsonSerialize(encode(map));
    const back = jsonDeserialize<Map<string, Date>>(text, reviver);

    ok(back instanceof Map);
    ok(back.get('a') instanceof Date);
    strictEqual(back.get('a')!.toISOString(), date.toISOString());
  });

  it('first matching codec wins', () => {
    const a: JSONCodec<string> = {
      name: 'a',
      test: (v): v is string => typeof v === 'string',
      encode: (v) => `A:${v}`,
      decode: (raw) => (raw as string).slice(2),
    };
    const b: JSONCodec<string> = { ...a, name: 'b', encode: (v) => `B:${v}` };

    const { encode } = composeCodecs(a, b);
    deepStrictEqual(encode('x'), { $a: 'A:x' });
  });

  it('leaves values matching no codec untouched', () => {
    const { encode } = composeCodecs(dateCodec);
    deepStrictEqual(encode({ x: 1, y: [2, 3] }), { x: 1, y: [2, 3] });
  });

  it('reviver ignores objects that are not single-key sentinels', () => {
    const { reviver } = composeCodecs(dateCodec);
    const out = jsonDeserialize<{ $date: string; extra: number }>(
      '{"$date":"2026-06-11T00:00:00.000Z","extra":1}',
      reviver,
    );
    deepStrictEqual(out, { $date: '2026-06-11T00:00:00.000Z', extra: 1 });
  });

  it('reviver ignores unregistered sentinel names', () => {
    const { reviver } = composeCodecs(dateCodec);
    const out = jsonDeserialize<{ $other: string }>('{"$other":"x"}', reviver);
    deepStrictEqual(out, { $other: 'x' });
  });

  it('roundtrips deeply nested codec values', () => {
    const { encode, reviver } = composeCodecs(dateCodec);
    const date = new Date('2026-06-11T00:00:00.000Z');
    const value = { list: [{ when: date }, { when: date }] };

    const back = jsonDeserialize<typeof value>(jsonSerialize(encode(value)), reviver);
    strictEqual(back.list[0]!.when.toISOString(), date.toISOString());
    strictEqual(back.list[1]!.when.toISOString(), date.toISOString());
  });
});
