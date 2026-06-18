import { strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createPrompt, isCancel, type TextOptions } from '../../../../src/utils/cli/index.ts';

async function runText(script: string[], options: Partial<TextOptions> = {}) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  const result = prompt.text({ message: 'Name?', ...options });
  for (const chunk of script) input.write(chunk);
  return { result: await result, out };
}

describe('createPrompt().text', () => {
  it('resolves the typed value on Enter', async () => {
    const { result } = await runText([...'app', '\r']);
    strictEqual(result, 'app');
  });

  it('submits on a newline from piped input', async () => {
    const { result } = await runText([...'app', '\n']);
    strictEqual(result, 'app');
  });

  it('edits with backspace', async () => {
    const { result } = await runText([...'apx', '\x7f', 'p', '\r']);
    strictEqual(result, 'app');
  });

  it('uses defaultValue on an empty submit', async () => {
    const { result } = await runText(['\r'], { defaultValue: 'fallback' });
    strictEqual(result, 'fallback');
  });

  it('starts from initialValue', async () => {
    const { result } = await runText(['\r'], { initialValue: 'preset' });
    strictEqual(result, 'preset');
  });

  it('ignores tab when there is nothing to complete', async () => {
    const { result } = await runText(['a', '\t', 'b', '\r']);
    strictEqual(result, 'ab');
  });

  it('inserts at the cursor after moving left', async () => {
    const { result } = await runText([...'ac', '\x1b[D', 'b', '\r']);
    strictEqual(result, 'abc');
  });

  it('deletes forward with the Delete key', async () => {
    const { result } = await runText([...'ab', '\x1b[D', '\x1b[3~', '\r']);
    strictEqual(result, 'a');
  });

  it('jumps a word left with Ctrl+Left and inserts there', async () => {
    const { result } = await runText([...'foo bar', '\x1b[1;5D', 'X', '\r']);
    strictEqual(result, 'foo Xbar');
  });

  it('jumps a word left with Alt+b (macOS emacs binding)', async () => {
    const { result } = await runText([...'foo bar', '\x1bb', 'X', '\r']);
    strictEqual(result, 'foo Xbar');
  });

  it('deletes the previous word with Ctrl+W', async () => {
    const { result } = await runText([...'foo bar', '\x17', '\r']);
    strictEqual(result, 'foo ');
  });

  it('deletes the previous word with Alt+Backspace', async () => {
    const { result } = await runText([...'foo bar', '\x1b\x7f', '\r']);
    strictEqual(result, 'foo ');
  });

  it('deletes the next word with Alt+d', async () => {
    const { result } = await runText([...'foo bar', '\x1b[1;3D', '\x1bd', '\r']);
    strictEqual(result, 'foo ');
  });

  it('deletes forward with Ctrl+D', async () => {
    const { result } = await runText([...'ab', '\x1b[D', '\x04', '\r']);
    strictEqual(result, 'a');
  });

  it('clears the whole line with Ctrl+U', async () => {
    const { result } = await runText([...'hello world', '\x15', ...'hi', '\r']);
    strictEqual(result, 'hi');
  });

  it('clears only to the line start with Ctrl+U', async () => {
    const { result } = await runText([...'ab', '\x1b[D', '\x15', '\r']);
    strictEqual(result, 'b');
  });

  it('clears to the line end with Ctrl+K', async () => {
    const { result } = await runText([...'ab', '\x1b[D', '\x0b', '\r']);
    strictEqual(result, 'a');
  });

  it('jumps to the line start with Ctrl+A and inserts there', async () => {
    const { result } = await runText([...'bc', '\x01', 'a', '\r']);
    strictEqual(result, 'abc');
  });

  it('jumps to the line start with Home', async () => {
    const { result } = await runText([...'bc', '\x1b[H', 'a', '\r']);
    strictEqual(result, 'abc');
  });

  it('jumps to the line end with End after moving away', async () => {
    const { result } = await runText([...'ab', '\x01', '\x1b[F', 'c', '\r']);
    strictEqual(result, 'abc');
  });

  it('autocompletes the placeholder on Tab', async () => {
    const { result } = await runText(['\t', '\r'], { placeholder: 'app' });
    strictEqual(result, 'app');
  });

  it('appends an astral character', async () => {
    const { result } = await runText(['a', '😀', 'b', '\r']);
    strictEqual(result, 'a😀b');
  });

  it('blocks submission while validate returns an error', async () => {
    const validate = (value: string) => (value.length < 3 ? 'too short' : undefined);
    const { result } = await runText([...'ab', '\r', 'c', '\r'], { validate });
    strictEqual(result, 'abc');
  });

  it('renders the validation error message', async () => {
    const validate = (value: string) => (value === '' ? 'required' : undefined);
    const { out } = await runText(['\r', 'x', '\r'], { validate });
    strictEqual(out.join('').includes('required'), true);
  });

  it('validates the value with defaultValue applied', async () => {
    const seen: string[] = [];
    const validate = (value: string): undefined => {
      seen.push(value);
    };
    const { result } = await runText(['\r'], { defaultValue: 'app', validate });
    strictEqual(result, 'app');
    strictEqual(seen[0], 'app');
  });

  it('reds the whole rail and closes with a red corner on error', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('\rx\r');
    await prompt.text({ message: 'Name?', validate: (v) => (v === '' ? 'required' : undefined) });
    const frame = out.join('');
    strictEqual(frame.split('\x1b[31m│\x1b[39m').length - 1 >= 2, true);
    strictEqual(frame.includes('\x1b[31mName?\x1b[39m'), true);
    strictEqual(frame.includes('\x1b[31m└─ required\x1b[39m'), true);
  });

  it('renders inline markup in the validation error', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('\rx\r');
    await prompt.text({
      message: 'Name?',
      validate: (v) => (v === '' ? 'use `semver`' : undefined),
    });
    strictEqual(out.join('').includes('\x1b[1msemver\x1b[22m'), true);
  });

  it('cancels on Ctrl-C', async () => {
    const { result } = await runText([...'ab', '\x03']);
    strictEqual(isCancel(result), true);
  });

  it('renders the message', async () => {
    const { out } = await runText([...'x', '\r']);
    strictEqual(out.join('').includes('Name?'), true);
  });

  it('colors the symbol and the active message cyan when color is enabled', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('x\r');
    await prompt.text({ message: 'Name?' });
    strictEqual(out[0].startsWith('\x1b[36m◆'), true);
    strictEqual(out[0].includes('\x1b[36mName?\x1b[39m'), true);
  });

  it('renders backtick markup in the message as bold while active', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('x\r');
    await prompt.text({ message: 'set `port`' });
    strictEqual(out[0].includes('\x1b[1mport\x1b[22m'), true);
  });

  it('shows a placeholder hint while the input is empty', async () => {
    const { out } = await runText(['\r'], { placeholder: 'type here' });
    strictEqual(out[0].includes('type here'), true);
  });

  it('leads the first prompt with no rail and connects the next with one', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });

    input.write('a\r');
    await prompt.text({ message: 'One?' });
    const firstFrame = out[0];

    const before = out.length;
    input.write('b\r');
    await prompt.text({ message: 'Two?' });
    const secondFrame = out[before];

    strictEqual(firstFrame.startsWith('◆'), true);
    strictEqual(secondFrame.startsWith('│\n'), true);
  });

  it('scrolls a long value to keep the cursor visible while keeping it intact', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const output = { write: (s: string) => out.push(s), isTTY: true, columns: 14 };
    const prompt = createPrompt({ input, output, color: false });
    input.write('abcdefghijklmnopqrst\r');
    const result = await prompt.text({ message: 'v?' });
    strictEqual(result, 'abcdefghijklmnopqrst');

    const active = out.filter((s) => s.includes('◆'));
    const last = active[active.length - 1]!;
    strictEqual(last.includes('lmnopqrst'), true);
    strictEqual(last.includes('abcdef'), false);
  });

  it('truncates a long value to one line after submitting', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const output = { write: (s: string) => out.push(s), isTTY: true, columns: 14 };
    const prompt = createPrompt({ input, output, color: false });
    input.write('abcdefghijklmnopqrst\r');
    const result = await prompt.text({ message: 'v?' });
    strictEqual(result, 'abcdefghijklmnopqrst');

    const submitLine = out
      .find((s) => s.includes('◇'))!
      .split('\n')
      .find((l) => l.includes('…'))!;
    strictEqual(submitLine.includes('…'), true);
    strictEqual([...submitLine].length <= 13, true);
  });

  it('redraws on terminal resize', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    let onResize: (() => void) | undefined;
    const output = {
      write: (s: string) => out.push(s),
      isTTY: true,
      columns: 40,
      on: (_event: 'resize', listener: () => void) => void (onResize = listener),
      off: () => void (onResize = undefined),
    };
    const prompt = createPrompt({ input, output, color: false });
    const result = prompt.text({ message: 'v?' });

    const before = out.length;
    strictEqual(onResize !== undefined, true);
    output.columns = 10;
    onResize!();
    strictEqual(out.length > before, true);

    input.write('\r');
    await result;
  });
});
