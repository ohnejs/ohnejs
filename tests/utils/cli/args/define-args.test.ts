import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ResolvedArgs } from '../../../../src/utils/cli/index.ts';

import { defineArgs } from '../../../../src/utils/cli/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

const schema = defineArgs({
  name: { type: 'string', required: true },
  out: { type: 'string' },
  port: { type: 'number', default: 3000 },
  force: { type: 'boolean' },
  mode: { type: 'enum', options: ['dev', 'prod'] },
});
type Opts = ResolvedArgs<typeof schema>;

describe('defineArgs', () => {
  it('returns the schema unchanged', () => {
    deepStrictEqual(defineArgs({ a: { type: 'string' } }), { a: { type: 'string' } });
  });
});

describe('ResolvedArgs', () => {
  it('makes a required arg a present, non-optional value', () => {
    const type: Equal<Opts['name'], string> = true;
    const required: IsRequired<Opts, 'name'> = true;
    strictEqual(type && required, true);
  });

  it('makes a defaulted arg present', () => {
    const type: Equal<Opts['port'], number> = true;
    const required: IsRequired<Opts, 'port'> = true;
    strictEqual(type && required, true);
  });

  it('makes a boolean arg always present', () => {
    const type: Equal<Opts['force'], boolean> = true;
    const required: IsRequired<Opts, 'force'> = true;
    strictEqual(type && required, true);
  });

  it('narrows an enum to its options union and keeps it optional', () => {
    const type: Equal<Opts['mode'], 'dev' | 'prod' | undefined> = true;
    const optional: IsRequired<Opts, 'mode'> = false;
    strictEqual(type && !optional, true);
  });

  it('leaves a plain optional arg optional', () => {
    const type: Equal<Opts['out'], string | undefined> = true;
    const optional: IsRequired<Opts, 'out'> = false;
    strictEqual(type && !optional, true);
  });
});
