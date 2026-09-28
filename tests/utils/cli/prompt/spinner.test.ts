import { strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it, mock } from 'node:test';

import { createPrompt, createSpinner } from '../../../../src/utils/cli/index.ts';

type FakeInput = PassThrough & { isTTY?: boolean; setRawMode?(mode: boolean): void };

describe('createSpinner', () => {
  it('animates frames on a TTY and erases between them', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true },
      color: false,
      frames: ['A', 'B'],
      interval: 50,
    });

    spin.start('Working');
    mock.timers.tick(50);
    mock.timers.tick(50);
    spin.stop('Done');
    mock.timers.reset();

    const joined = out.join('');
    strictEqual(joined.includes('A  Working'), true);
    strictEqual(joined.includes('B  Working'), true);
    strictEqual(joined.includes('◇  Done'), true);
    strictEqual(
      out.some((s) => s.startsWith('\r\x1b[K')),
      true,
    );
  });

  it('updates the message in place', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true },
      color: false,
      frames: ['A'],
    });

    spin.start('First');
    spin.message('Second');
    spin.stop('Done');
    mock.timers.reset();

    strictEqual(out.join('').includes('A  Second'), true);
  });

  it('marks failure with a red square on a non-zero code', () => {
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true },
      color: true,
      frames: ['A'],
    });
    mock.timers.enable({ apis: ['setInterval'] });
    spin.start('Working');
    spin.stop('Failed', 1);
    mock.timers.reset();

    strictEqual(out.join('').includes('\x1b[31m■\x1b[39m  Failed'), true);
  });

  it('logs plain lines without animation off a TTY', () => {
    const out: string[] = [];
    const spin = createSpinner({ output: { write: (s) => out.push(s) }, frames: ['A'] });
    spin.start('Working');
    spin.stop('Done');

    const joined = out.join('');
    strictEqual(joined.includes('\x1b[?25l'), false);
    strictEqual(joined.includes('A  Working\n'), true);
    strictEqual(joined.includes('◇  Done\n'), true);
    strictEqual(joined.includes('\r\x1b[K'), false);
  });

  it('ignores a second start and a stop after stopping', () => {
    const out: string[] = [];
    const spin = createSpinner({ output: { write: (s) => out.push(s) }, frames: ['A'] });
    spin.start('One');
    spin.start('Two');
    spin.stop('Done');
    const before = out.length;
    spin.stop('Again');
    strictEqual(out.length, before);
    strictEqual(out.join('').includes('Two'), false);
  });

  it('hides and restores the cursor on a TTY', () => {
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true },
      frames: ['A'],
    });
    mock.timers.enable({ apis: ['setInterval'] });
    spin.start('Working');
    spin.stop('Done');
    mock.timers.reset();

    const joined = out.join('');
    strictEqual(joined.includes('\x1b[?25l'), true);
    strictEqual(joined.includes('\x1b[?25h'), true);
  });

  it('captures keystrokes on a TTY and restores raw mode on stop', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const raw: boolean[] = [];
    const input = new PassThrough() as FakeInput;
    input.isTTY = true;
    input.setRawMode = (mode) => void raw.push(mode);
    const out: string[] = [];
    const spin = createSpinner({
      input,
      output: { write: (s) => out.push(s), isTTY: true },
      color: false,
      frames: ['A'],
    });

    spin.start('Working');
    strictEqual(raw[0], true);
    const before = out.length;
    input.write('\r');
    strictEqual(out.length, before);
    spin.stop('Done');
    mock.timers.reset();

    strictEqual(raw.at(-1), false);
  });

  it('leaves real input untouched when it is not a TTY', () => {
    const raw: boolean[] = [];
    const input = new PassThrough() as FakeInput;
    input.setRawMode = (mode) => void raw.push(mode);
    const out: string[] = [];
    const spin = createSpinner({
      input,
      output: { write: (s) => out.push(s), isTTY: true },
      frames: ['A'],
    });
    mock.timers.enable({ apis: ['setInterval'] });
    spin.start('Working');
    spin.stop('Done');
    mock.timers.reset();

    strictEqual(raw.length, 0);
  });

  it('leads with a connecting rail after a prior prompt in a flow', () => {
    const out: string[] = [];
    const spin = createSpinner({
      output: { write: (s) => out.push(s) },
      lead: true,
      frames: ['A'],
    });
    spin.start('Working');
    strictEqual(out[0], '│\n');
  });

  it('frames the animating spinner with a trailing rail and clears it on stop', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true },
      color: false,
      lead: true,
      frames: ['A'],
    });

    spin.start('Working');
    strictEqual(out.join('').includes('\n\x1b[K│\x1b[1A'), true);

    spin.stop('Done');
    mock.timers.reset();

    strictEqual(out.includes('\x1b[K'), true);
  });

  it('clips an animating message to the terminal columns and keeps the whole final line', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true, columns: 20 },
      color: false,
      frames: ['A', 'B'],
      interval: 50,
    });

    spin.start('Installing a-very-long-package-name');
    mock.timers.tick(50);
    spin.stop('Installed a-very-long-package-name');
    mock.timers.reset();

    const frames = out.filter((s) => s.startsWith('\r\x1b[K'));
    strictEqual(frames.includes('\r\x1b[KA  Installing a-ver…'), true);
    strictEqual(frames.includes('\r\x1b[KB  Installing a-ver…'), true);
    strictEqual(frames.at(-1), '\r\x1b[K◇  Installed a-very-long-package-name\n');
  });

  it('clips a styled message by its visible columns, keeping every escape whole', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const out: string[] = [];
    const spin = createSpinner({
      input: new PassThrough(),
      output: { write: (s) => out.push(s), isTTY: true, columns: 20 },
      color: false,
      frames: ['A'],
      interval: 50,
    });

    spin.start('\x1b[1mInstalling\x1b[22m a-very-long-package-name');
    spin.stop();
    mock.timers.reset();

    strictEqual(out.includes('\r\x1b[KA  \x1b[1mInstalling\x1b[22m a-ver…'), true);
  });
});

describe('createPrompt().spinner', () => {
  it('binds to the prompt stream and connects to the rail after a prompt', async () => {
    const out: string[] = [];
    const prompt = createPrompt({ output: { write: (s) => out.push(s) }, color: false });
    prompt.intro('Start');
    out.length = 0;
    const spin = prompt.spinner({ frames: ['A'] });
    spin.start('Working');
    spin.stop('Done');
    strictEqual(out.join('').includes('Done'), true);
    strictEqual(out.join('').includes('│'), true);
  });
});
