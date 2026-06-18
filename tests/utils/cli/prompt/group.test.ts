import { deepStrictEqual, strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createPrompt, group, isCancel } from '../../../../src/utils/cli/index.ts';

function harness() {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  return { input, out, prompt };
}

describe('group', () => {
  it('runs steps in key order and returns a typed result object', async () => {
    const { input, prompt } = harness();
    const run = group<{ name: string; ts: boolean }>({
      name: () => prompt.text({ message: 'Name?' }),
      ts: () => prompt.confirm({ message: 'TypeScript?' }),
    });
    input.write('app\r');
    input.write('\r');
    const result = await run;
    deepStrictEqual(result, { name: 'app', ts: true });
  });

  it('threads gathered results into later steps', async () => {
    const { input, prompt } = harness();
    const seen: string[] = [];
    const run = group<{ name: string; confirmed: boolean }>({
      name: () => prompt.text({ message: 'Name?' }),
      confirmed: (results) => {
        seen.push(results.name as string);
        return prompt.confirm({ message: 'Ok?' });
      },
    });
    input.write('app\r');
    input.write('\r');
    await run;
    deepStrictEqual(seen, ['app']);
  });

  it('short-circuits to CANCEL when a step is cancelled', async () => {
    const { input, prompt } = harness();
    let reached = false;
    const run = group<{ name: string; ts: boolean }>({
      name: () => prompt.text({ message: 'Name?' }),
      ts: () => {
        reached = true;
        return prompt.confirm({ message: 'TypeScript?' });
      },
    });
    input.write('\x03');
    const result = await run;
    strictEqual(isCancel(result), true);
    strictEqual(reached, false);
  });
});
