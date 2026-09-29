import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { StepEvent } from '../../../src/ai/providers/provider.ts';

import { retried, retriedStream, retryWait } from '../../../src/ai/providers/_retry.ts';
import { providerError } from '../../../src/ai/providers/provider.ts';

const transient = (wait?: number): Error =>
  providerError({ code: 'status', message: 'busy', status: 429, retry: true, wait });

const done: StepEvent = {
  type: 'done',
  calls: [],
  stop: 'end',
  usage: { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  model: 'm',
  items: [],
};

describe('retryWait', () => {
  it('backs off from 500ms, doubling per rerun, for at most two reruns', () => {
    strictEqual(retryWait(transient(), 1), 500);
    strictEqual(retryWait(transient(), 2), 1000);
    strictEqual(retryWait(transient(), 3), null);
  });

  it('waits what the provider asked, unless it is over a minute', () => {
    strictEqual(retryWait(transient(0), 1), 0);
    strictEqual(retryWait(transient(2000), 2), 2000);
    strictEqual(retryWait(transient(60_001), 1), null);
  });

  it('never reruns a failure that is not retryable, or not a provider failure', () => {
    strictEqual(retryWait(providerError({ code: 'status', message: 'bad', status: 400 }), 1), null);
    strictEqual(retryWait(new Error('bad'), 1), null);
  });
});

describe('retriedStream', () => {
  it('announces the wait and streams again after a failed run', async () => {
    let runs = 0;
    const events = await Array.fromAsync(
      retriedStream(async function* () {
        runs++;
        yield { type: 'text', text: `run ${runs}` };
        if (runs === 1) throw transient(0);
        yield done;
      }, new AbortController().signal),
    );
    deepStrictEqual(events, [
      { type: 'text', text: 'run 1' },
      { type: 'retry', wait: 0 },
      { type: 'text', text: 'run 2' },
      done,
    ]);
  });

  it('throws the failure that ends the last rerun', async () => {
    let runs = 0;
    const events: StepEvent[] = [];
    await rejects(
      async () => {
        for await (const event of retriedStream(async function* () {
          runs++;
          yield { type: 'text', text: '' };
          throw transient(0);
        }, new AbortController().signal)) {
          events.push(event);
        }
      },
      { message: 'busy' },
    );
    strictEqual(runs, 3);
    strictEqual(events.filter((event) => event.type === 'retry').length, 2);
  });

  it('throws the reason of an abort instead of rerunning', async () => {
    const controller = new AbortController();
    await rejects(
      Array.fromAsync(
        retriedStream(async function* () {
          yield { type: 'text', text: '' };
          controller.abort(new Error('gone'));
          throw transient(0);
        }, controller.signal),
      ),
      { message: 'gone' },
    );
  });
});

describe('retried', () => {
  it('reruns a failed call and resolves with the answer', async () => {
    let runs = 0;
    const value = await retried(async () => {
      runs++;
      if (runs < 3) throw transient(0);
      return 'ok';
    }, new AbortController().signal);
    strictEqual(value, 'ok');
    strictEqual(runs, 3);
  });

  it('throws the failure that ends the last rerun', async () => {
    let runs = 0;
    await rejects(
      retried(async () => {
        runs++;
        throw transient(0);
      }, new AbortController().signal),
      { message: 'busy' },
    );
    strictEqual(runs, 3);
  });

  it('throws the reason of an abort during the wait', async () => {
    const controller = new AbortController();
    await rejects(
      retried(async () => {
        setTimeout(() => controller.abort(new Error('gone')), 10);
        throw transient(5000);
      }, controller.signal),
      { message: 'gone' },
    );
  });
});
