import { deepStrictEqual, strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import {
  createPrompt,
  isCancel,
  type MultiselectOptions,
} from '../../../../src/utils/cli/index.ts';

const FRUITS = [
  { value: 'apple', label: 'Apple' },
  { value: 'pear', label: 'Pear' },
  { value: 'plum', label: 'Plum' },
];

async function runMultiselect<T>(script: string[], options: MultiselectOptions<T>) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  const result = prompt.multiselect(options);
  for (const chunk of script) input.write(chunk);
  return { result: await result, out };
}

describe('createPrompt().multiselect', () => {
  it('resolves an empty array when nothing is checked', async () => {
    const { result } = await runMultiselect(['\r'], { message: 'Fruit?', options: FRUITS });
    deepStrictEqual(result, []);
  });

  it('toggles the cursor row with space', async () => {
    const { result } = await runMultiselect([' ', '\r'], { message: 'Fruit?', options: FRUITS });
    deepStrictEqual(result, ['apple']);
  });

  it('checks several rows in display order', async () => {
    const { result } = await runMultiselect([' ', '\x1b[B', '\x1b[B', ' ', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    deepStrictEqual(result, ['apple', 'plum']);
  });

  it('preserves display order regardless of selection order', async () => {
    const { result } = await runMultiselect(
      ['\x1b[B', '\x1b[B', ' ', '\x1b[A', '\x1b[A', ' ', '\r'],
      {
        message: 'Fruit?',
        options: FRUITS,
      },
    );
    deepStrictEqual(result, ['apple', 'plum']);
  });

  it('unchecks a row when toggled twice', async () => {
    const { result } = await runMultiselect([' ', ' ', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    deepStrictEqual(result, []);
  });

  it('starts from initialValues', async () => {
    const { result } = await runMultiselect(['\r'], {
      message: 'Fruit?',
      options: FRUITS,
      initialValues: ['pear'],
    });
    deepStrictEqual(result, ['pear']);
  });

  it('selects all with a and clears all on a second press', async () => {
    const all = await runMultiselect(['a', '\r'], { message: 'Fruit?', options: FRUITS });
    deepStrictEqual(all.result, ['apple', 'pear', 'plum']);
    const none = await runMultiselect(['a', 'a', '\r'], { message: 'Fruit?', options: FRUITS });
    deepStrictEqual(none.result, []);
  });

  it('blocks an empty submit when required and accepts once a row is checked', async () => {
    const { result, out } = await runMultiselect(['\r', ' ', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
      required: true,
    });
    deepStrictEqual(result, ['apple']);
    strictEqual(out.join('').includes('Select at least one option.'), true);
  });

  it('reds the rail and flattens the title to one red on a failed required submit', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('\r \r');
    await prompt.multiselect({ message: 'Pick `one`?', options: FRUITS, required: true });
    const frame = out.find((s) => s.includes('Select at least one option.'))!;
    strictEqual(frame.includes('\x1b[31m│\x1b[39m'), true);
    strictEqual(frame.includes('\x1b[31mPick one?\x1b[39m'), true);
    strictEqual(frame.includes('\x1b[1m'), false);
  });

  it('wraps the cursor with up from the first row', async () => {
    const { result } = await runMultiselect(['\x1b[A', ' ', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    deepStrictEqual(result, ['plum']);
  });

  it('cancels on Ctrl-C', async () => {
    const { result } = await runMultiselect(['\x03'], { message: 'Fruit?', options: FRUITS });
    strictEqual(isCancel(result), true);
  });

  it('shows a green box checked-and-unfocused and a cyan box on the cursor', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write(' \x1b[B\r');
    await prompt.multiselect({ message: 'Fruit?', options: FRUITS });
    const active = out.filter((s) => s.includes('◼') || s.includes('◻'));
    const frame = active[active.length - 1]!;
    strictEqual(frame.includes('\x1b[32m◼\x1b[39m Apple'), true);
    strictEqual(frame.includes('\x1b[96m◻\x1b[39m Pear'), true);
  });

  it('summarizes the checked labels after submitting', async () => {
    const { out } = await runMultiselect([' ', '\r'], { message: 'Fruit?', options: FRUITS });
    const submit = out.find((s) => s.includes('◇'))!;
    strictEqual(submit.includes('Apple'), true);
    strictEqual(submit.includes('Pear'), false);
  });

  it('summarizes an empty submit as none', async () => {
    const { out } = await runMultiselect(['\r'], { message: 'Fruit?', options: FRUITS });
    const submit = out.find((s) => s.includes('◇'))!;
    strictEqual(submit.includes('none'), true);
  });
});
