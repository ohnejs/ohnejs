import { strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { terminalWidth } from '../../../../src/utils/ansi/index.ts';
import { createPrompt } from '../../../../src/utils/cli/index.ts';

function harness(color = false) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color });
  return { input, out, prompt };
}

describe('createPrompt().intro', () => {
  it('opens with a top corner and the title, no rail', () => {
    const { out, prompt } = harness();
    prompt.intro('My App');
    strictEqual(out[0], '┌  My App\n');
  });

  it('renders inline markup in the title', () => {
    const { out, prompt } = harness(true);
    prompt.intro('create `ohne`');
    strictEqual(out[0].includes('\x1b[96mohne\x1b[39m'), true);
  });

  it('makes the next prompt connect with a rail', async () => {
    const { input, out, prompt } = harness();
    prompt.intro('My App');
    const before = out.length;
    input.write('x\r');
    await prompt.text({ message: 'Name?' });
    strictEqual(out[before].startsWith('│\n'), true);
  });
});

describe('createPrompt().outro', () => {
  it('closes with a spacer rail and a bottom corner after a prompt', async () => {
    const { input, out, prompt } = harness();
    input.write('x\r');
    await prompt.text({ message: 'Name?' });
    const before = out.length;
    prompt.outro('Done');
    strictEqual(out[before], '│\n└  Done\n');
  });

  it('stands alone with no rail when it opens the output', () => {
    const { out, prompt } = harness();
    prompt.outro('Bye');
    strictEqual(out[0], '└  Bye\n');
  });
});

describe('createPrompt().note', () => {
  it('frames the message in a box with the title on the top edge', () => {
    const { out, prompt } = harness();
    prompt.note('line one', 'Heads up');
    const frame = out[0];
    strictEqual(frame.includes('◇  Heads up '), true);
    strictEqual(frame.includes('╮'), true);
    strictEqual(frame.includes('│  line one'), true);
    strictEqual(frame.includes('╯'), true);
  });

  it('sizes the border to the widest line', () => {
    const { out, prompt } = harness();
    prompt.note('short\na much longer line', 'T');
    const rows = out[0].split('\n');
    const widths = rows.filter((r) => r.includes('│') || r.includes('╮') || r.includes('╯'));
    const lengths = widths.map((r) => [...r].length);
    strictEqual(new Set(lengths).size, 1);
  });

  it('sizes the border to wide characters in terminal columns', () => {
    const { out, prompt } = harness();
    prompt.note('short\n漢字 and 😀', 'T');
    const rows = out[0].split('\n');
    const framed = rows.filter((r) => r.includes('│') || r.includes('╮') || r.includes('╯'));
    strictEqual(new Set(framed.map(terminalWidth)).size, 1);
  });

  it('connects to the rail after a prior prompt', async () => {
    const { input, out, prompt } = harness();
    input.write('x\r');
    await prompt.text({ message: 'Name?' });
    const before = out.length;
    prompt.note('info', 'Note');
    strictEqual(out[before].startsWith('│\n'), true);
  });

  it('closes with a terminal corner when it is the last note', () => {
    const { out, prompt } = harness();
    prompt.note('info', 'Done', true);
    const frame = out[0];
    strictEqual(frame.includes('└'), true);
    strictEqual(frame.includes('├'), false);
  });
});
