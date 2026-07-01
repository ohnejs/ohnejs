import { deepStrictEqual, strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createPrompt, isCancel, type SelectOptions } from '../../../../src/utils/cli/index.ts';

const FRUITS = [
  { value: 'apple', label: 'Apple' },
  { value: 'pear', label: 'Pear' },
  { value: 'plum', label: 'Plum' },
];

async function runSelect<T>(script: string[], options: SelectOptions<T>) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  const result = prompt.select(options);
  for (const chunk of script) input.write(chunk);
  return { result: await result, out };
}

describe('createPrompt().select', () => {
  it('resolves the first option by default', async () => {
    const { result } = await runSelect(['\r'], { message: 'Fruit?', options: FRUITS });
    strictEqual(result, 'apple');
  });

  it('moves down with the arrow key', async () => {
    const { result } = await runSelect(['\x1b[B', '\r'], { message: 'Fruit?', options: FRUITS });
    strictEqual(result, 'pear');
  });

  it('moves down with j and up with k', async () => {
    const { result } = await runSelect(['j', 'j', 'k', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    strictEqual(result, 'pear');
  });

  it('wraps from the first option to the last on up', async () => {
    const { result } = await runSelect(['\x1b[A', '\r'], { message: 'Fruit?', options: FRUITS });
    strictEqual(result, 'plum');
  });

  it('wraps from the last option to the first on down', async () => {
    const { result } = await runSelect(['\x1b[A', '\x1b[B', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    strictEqual(result, 'apple');
  });

  it('starts on the initialValue', async () => {
    const { result } = await runSelect(['\r'], {
      message: 'Fruit?',
      options: FRUITS,
      initialValue: 'plum',
    });
    strictEqual(result, 'plum');
  });

  it('jumps to the last option with End and the first with Home', async () => {
    const { result } = await runSelect(['\x1b[F', '\x1b[H', '\r'], {
      message: 'Fruit?',
      options: FRUITS,
    });
    strictEqual(result, 'apple');
  });

  it('resolves a non-string value', async () => {
    const numbers = [{ value: 1 }, { value: 2 }, { value: 3 }];
    const { result } = await runSelect(['\x1b[B', '\x1b[B', '\r'], {
      message: 'Pick?',
      options: numbers,
    });
    strictEqual(result, 3);
  });

  it('cancels on Ctrl-C', async () => {
    const { result } = await runSelect(['\x03'], { message: 'Fruit?', options: FRUITS });
    strictEqual(isCancel(result), true);
  });

  it('ignores navigation and submit on an empty list instead of crashing', async () => {
    const { result } = await runSelect(['\x1b[B', '\x1b[A', '\x1b[F', '\x1b[H', '\r', '\x03'], {
      message: 'Empty?',
      options: [],
    });
    strictEqual(isCancel(result), true);
  });

  it('marks the cursor row with a cyan bullet and plain text while dimming the rest', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('\r');
    await prompt.select({ message: 'Fruit?', options: FRUITS });
    strictEqual(out[0].includes('\x1b[96m●\x1b[39m Apple'), true);
    strictEqual(out[0].includes('\x1b[2m○ Pear\x1b[22m'), true);
  });

  it('shows the focused option hint', async () => {
    const { out } = await runSelect(['\r'], {
      message: 'Fruit?',
      options: [{ value: 'apple', label: 'Apple', hint: 'crisp' }, ...FRUITS.slice(1)],
    });
    strictEqual(out[0].includes('crisp'), true);
  });

  it('falls back to the stringified value as the label', async () => {
    const { out } = await runSelect(['\r'], { message: 'Pick?', options: [{ value: 7 }] });
    strictEqual(out[0].includes('7'), true);
  });

  it('windows a long list and marks the overflow with an ellipsis', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ value: i, label: `Item ${i}` }));
    const { out } = await runSelect(['\r'], { message: 'Pick?', options: many, maxItems: 4 });
    const frame = out[0];
    strictEqual(frame.includes('…'), true);
    strictEqual(frame.includes('Item 0'), true);
    strictEqual(frame.includes('Item 7'), false);
  });

  it('keeps the highlighted row visible after scrolling down', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ value: i, label: `Item ${i}` }));
    const { out } = await runSelect([...'\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B', '\r'], {
      message: 'Pick?',
      options: many,
      maxItems: 4,
    });
    const active = out.filter((s) => s.includes('●'));
    const last = active[active.length - 1]!;
    strictEqual(last.includes('● Item 5'), true);
  });

  it('collapses to the chosen label after submitting', async () => {
    const { out } = await runSelect(['\x1b[B', '\r'], { message: 'Fruit?', options: FRUITS });
    const submit = out.find((s) => s.includes('◇'))!;
    strictEqual(submit.includes('Pear'), true);
    strictEqual(submit.includes('●'), false);
  });

  it('preserves option order in the resolved value across moves', async () => {
    const seen: string[] = [];
    const { result } = await runSelect(['j', 'k', '\r'], { message: 'Fruit?', options: FRUITS });
    seen.push(result as string);
    deepStrictEqual(seen, ['apple']);
  });
});
