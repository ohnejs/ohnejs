import type { User } from 'ohnejs/auth';
import type { RateLimiter } from 'ohnejs/utils';

import {
  DEFAULT_RATE_LIMIT_STORE,
  enforceRateLimit,
  ohneError,
  tooManyRequests,
  useConfig,
  useRateLimitStore,
  useRequest,
  useResponse,
} from 'ohnejs';
import { createPermits, createRateLimiter, isNull, isUndefined, parseDuration } from 'ohnejs/utils';

import type { Usage } from '../providers/provider.ts';

import { useAIConfig } from '../config.ts';
import { usageCost } from '../providers/provider.ts';

/**
 * The most steps one process streams at once.
 */
const MAX_OPEN_STEPS = 32;

/**
 * The most steps one person streams at once.
 */
const MAX_OPEN_STEPS_PER_USER = 2;

interface Limiters {
  turns: RateLimiter | false;
  tokens: RateLimiter | false;
}

const permits = createPermits(MAX_OPEN_STEPS, MAX_OPEN_STEPS_PER_USER);
const limiters = new WeakMap<object, Limiters>();

/**
 * Counts one turn against the person, and answers `429` past `ai.limits.turns`.
 */
export async function enforceTurnsLimit(user: User): Promise<void> {
  const { turns } = rateLimiters();
  if (turns !== false) await enforceRateLimit(turns, user.UUID);
}

/**
 * Answers `429` with `Retry-After` while the person's token budget is spent, and counts nothing.
 * Asked before every step, so a person past `ai.limits.tokens` runs no more of them.
 */
export async function probeTokens(user: User): Promise<void> {
  const { tokens } = rateLimiters();
  if (tokens === false) return;
  const wait = await tokens.charge(user.UUID, 0);
  if (wait === 0) return;
  useResponse().headers.set('Retry-After', String(Math.ceil(wait / 1000)));
  throw tooManyRequests();
}

/**
 * Counts a step's tokens against the person, even past the budget, so the crossing step counts.
 */
export async function chargeTokens(user: User, usage: Usage): Promise<void> {
  const { tokens } = rateLimiters();
  if (tokens !== false) await tokens.charge(user.UUID, usageCost(usage));
}

/**
 * Takes a permit to stream one step, and returns the release fn to call once the stream ends.
 * A person already streaming two steps, or a process streaming its cap, gets `429`.
 */
export function acquireStepPermit(user: User): () => void {
  const release = permits.acquire(user.UUID);
  if (isNull(release)) throw tooManyRequests();
  return release;
}

/**
 * The signal one provider step runs under: the request's own, or `ai.limits.step` elapsing.
 * Valid only within a request.
 */
export function stepSignal(): AbortSignal {
  const { step } = useAIConfig().limits;
  return AbortSignal.any([useRequest().signal, AbortSignal.timeout(parseDuration(step))]);
}

/**
 * Refuses an `ai.limits.tokens` the app's rate-limit store cannot count, with an error block naming it.
 * Tokens are weighted hits, so the store needs `charge`; the shipped stores have it.
 */
export function assertTokenStore(): void {
  if (useAIConfig().limits.tokens === false || !isUndefined(useRateLimitStore().charge)) return;
  const name = useConfig().api.rateLimitStore ?? DEFAULT_RATE_LIMIT_STORE;
  throw ohneError({
    title: `The rate-limit store \`${name}\` cannot count tokens`,
    body: [
      '`ai.limits.tokens` charges each step by its tokens, which needs `charge` on the store.',
      `The store \`${name}\` under \`api.rateLimitStore\` has no \`charge\`.`,
      '',
      'Add `charge` to the store, pick one that has it, or set `ai.limits.tokens: false`.',
    ],
  });
}

/**
 * The turns and tokens limiters, built once per resolved config in the app's rate-limit store.
 */
function rateLimiters(): Limiters {
  const config = useConfig();
  let built = limiters.get(config);
  if (isUndefined(built)) {
    const { turns, tokens } = useAIConfig().limits;
    const store = useRateLimitStore();
    built = {
      turns:
        turns === false ? false : createRateLimiter({ ...turns, name: 'ohne:ai:turns', store }),
      tokens:
        tokens === false ? false : createRateLimiter({ ...tokens, name: 'ohne:ai:tokens', store }),
    };
    limiters.set(config, built);
  }
  return built;
}
