import { strictEqual } from 'node:assert';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { type ConfirmOptions, createPrompt, isCancel } from '../../../../src/utils/cli/index.ts';

async function runConfirm(script: string[], options: Partial<ConfirmOptions> = {}) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  const result = prompt.confirm({ message: 'Sure?', ...options });
  for (const chunk of script) input.write(chunk);
  return { result: await result, out };
}

describe('createPrompt().confirm', () => {
  it('defaults to the affirmative and submits on Enter', async () => {
    const { result } = await runConfirm(['\r']);
    strictEqual(result, true);
  });

  it('honors an initialValue of false', async () => {
    const { result } = await runConfirm(['\r'], { initialValue: false });
    strictEqual(result, false);
  });

  it('submits true on the y key', async () => {
    const { result } = await runConfirm(['y'], { initialValue: false });
    strictEqual(result, true);
  });

  it('submits false on the n key', async () => {
    const { result } = await runConfirm(['n']);
    strictEqual(result, false);
  });

  it('toggles to false with the right arrow', async () => {
    const { result } = await runConfirm(['\x1b[C', '\r']);
    strictEqual(result, false);
  });

  it('toggles back to true with the left arrow', async () => {
    const { result } = await runConfirm(['\x1b[C', '\x1b[D', '\r']);
    strictEqual(result, true);
  });

  it('flips the selection with Tab', async () => {
    const { result } = await runConfirm(['\t', '\r']);
    strictEqual(result, false);
  });

  it('flips with the up arrow', async () => {
    const { result } = await runConfirm(['\x1b[A', '\r']);
    strictEqual(result, false);
  });

  it('renders custom labels', async () => {
    const { out } = await runConfirm(['\r'], { active: 'Keep', inactive: 'Drop' });
    const frame = out.join('');
    strictEqual(frame.includes('Keep'), true);
    strictEqual(frame.includes('Drop'), true);
  });

  it('cancels on Ctrl-C', async () => {
    const { result } = await runConfirm(['\x03']);
    strictEqual(isCancel(result), true);
  });

  it('marks the selected side with a filled radio and dims the other while active', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, output: { write: (s) => out.push(s) }, color: true });
    input.write('\r');
    await prompt.confirm({ message: 'Sure?' });
    strictEqual(out[0].includes('\x1b[96m●\x1b[39m Yes'), true);
    strictEqual(out[0].includes('\x1b[2m○ No\x1b[22m'), true);
  });

  it('collapses to the chosen label after submitting', async () => {
    const { out } = await runConfirm(['n']);
    const submit = out.find((s) => s.includes('◇'))!;
    strictEqual(submit.includes('No'), true);
    strictEqual(submit.includes('●'), false);
  });
});
