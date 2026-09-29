import { isNull, sleep } from 'ohnejs/utils';

import type { StepEvent } from './provider.ts';

import { isProviderError } from './provider.ts';

/**
 * How often a failed run starts over.
 */
const RERUNS = 2;

/**
 * The first wait when the provider names none; each rerun doubles it.
 */
const BACKOFF = 500;

/**
 * The longest `Retry-After` waited out; a longer one fails the call instead.
 */
const MAX_WAIT = 60_000;

/**
 * Milliseconds to wait before rerun number `rerun` after `error`, or `null` when it is not rerun.
 * Only a retryable `ProviderError` is rerun, at most twice.
 * The wait is the provider's `Retry-After` when it named one, else 500ms doubling per rerun.
 * A `Retry-After` beyond a minute is not waited out.
 */
export function retryWait(error: unknown, rerun: number): number | null {
  if (rerun > RERUNS || !isProviderError(error) || !error.retry) return null;
  const wait = error.wait ?? BACKOFF * 2 ** (rerun - 1);
  return wait > MAX_WAIT ? null : wait;
}

/**
 * Streams `run` and starts it over after a retryable failure, yielding a `retry` with the wait first.
 * The failure that ends the last rerun is thrown; an aborted `signal` throws its reason at once.
 */
export async function* retriedStream(
  run: () => AsyncIterable<StepEvent>,
  signal: AbortSignal,
): AsyncGenerator<StepEvent> {
  for (let rerun = 1; ; rerun++) {
    try {
      yield* run();
      return;
    } catch (error) {
      signal.throwIfAborted();
      const wait = retryWait(error, rerun);
      if (isNull(wait)) throw error;
      yield { type: 'retry', wait };
      await sleep(wait, { signal });
    }
  }
}

/**
 * Awaits `run` and starts it over after a retryable failure, waiting as `retryWait` says.
 * The failure that ends the last rerun is thrown; an aborted `signal` throws its reason at once.
 */
export async function retried<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let rerun = 1; ; rerun++) {
    try {
      return await run();
    } catch (error) {
      signal.throwIfAborted();
      const wait = retryWait(error, rerun);
      if (isNull(wait)) throw error;
      await sleep(wait, { signal });
    }
  }
}
