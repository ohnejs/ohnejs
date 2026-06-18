import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineCommand } from '../../../../src/utils/cli/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const cmd = defineCommand({
  meta: { name: 'x' },
  args: { port: { type: 'number', default: 3000 }, mode: { type: 'enum', options: ['a', 'b'] } },
  run() {},
});
type Ctx = Parameters<NonNullable<typeof cmd.run>>[0];

describe('defineCommand', () => {
  it('returns the command unchanged', () => {
    const command = { meta: { name: 'x' }, run() {} };
    strictEqual(defineCommand(command), command);
  });

  it('types the run context from the args schema', () => {
    const port: Equal<Ctx['values']['port'], number> = true;
    const mode: Equal<Ctx['values']['mode'], 'a' | 'b' | undefined> = true;
    const positionals: Equal<Ctx['positionals'], string[]> = true;
    strictEqual(port && mode && positionals, true);
  });
});
