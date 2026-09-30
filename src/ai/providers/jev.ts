import type { FlowQuestion } from 'ohnejs';

import {
  hasKey,
  isNumber,
  isPlainObject,
  isString,
  merge,
  withoutTrailingSlash,
} from 'ohnejs/utils';

import type { DecideAnswer, Decider, Decision, ProviderOptions, Usage } from './provider.ts';

import { retried } from './_retry.ts';
import { bearer, postJSON } from './_wire.ts';
import { providerError } from './provider.ts';

type WireQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

type WireAnswer = {
  type?: string;
  choice?: unknown;
  score?: unknown;
  noul?: unknown;
  confidence?: unknown;
};

type WireResponse = {
  model?: unknown;
  answers?: Record<string, WireAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const API = 'https://api.typesafe.ai';

/**
 * What a `choice` question asks, since Jev takes instructions beside the options and a flow writes none.
 */
const CHOICE_INSTRUCTIONS = 'Which option describes the message best?';

/**
 * What a `score` question asks, the levels standing for the scale.
 */
const SCORE_INSTRUCTIONS = 'Where on this scale does the message fall, lowest level first?';

/**
 * Builds the decider for Jev, the TypeSafe AI decision model, over `POST /v1/systemone`.
 * Every question of a request goes in one call and is answered against the same `state`, the message.
 * `choice` and `score` carry their own `confidence`; a `noul`, the wire's yes-or-no, answers a probability.
 * A `score` answers a float along the levels, which rounds to the nearest one.
 * The answer is not streamed; a `429` or a `5xx` reruns it as any provider call, honouring `Retry-After`.
 *
 * @example
 * ```ts
 * const jev = createJevProvider({ model: 'jev-latest', key })
 * const { answers } = await jev.decide({ input, questions }, signal)
 * answers.intent // -> { answer: 'translate', confidence: 0.82 }
 * ```
 */
export function createJevProvider(options: ProviderOptions): Decider {
  const url = `${withoutTrailingSlash(options.baseURL ?? API)}/v1/systemone`;
  const headers = { ...bearer(options.key), ...options.headers };
  return {
    decide(request, signal) {
      const questions = Object.fromEntries(
        Object.entries(request.questions).map(([name, question]) => [name, toWire(question)]),
      );
      const body = merge(options.options, {
        model: options.model,
        state: request.input,
        questions,
      });
      return retried(
        async () => toDecision(await postJSON(url, { headers, body, signal }), request.questions),
        signal,
      );
    },
  };
}

/**
 * A flow question as the wire takes it.
 */
function toWire(question: FlowQuestion): WireQuestion {
  if ('choice' in question) {
    return { type: 'choice', instructions: CHOICE_INSTRUCTIONS, criteria: question.choice };
  }
  if ('score' in question) {
    return { type: 'score', instructions: SCORE_INSTRUCTIONS, criteria: question.score };
  }
  return { type: 'noul', instructions: question.yesNo };
}

/**
 * The decision off the wire's answer, each question's answer checked against its options.
 */
function toDecision(value: unknown, questions: Record<string, FlowQuestion>): Decision {
  const response = isPlainObject(value) ? (value as WireResponse) : {};
  const answered = isPlainObject(response.answers) ? response.answers : {};
  const answers: Record<string, DecideAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = hasKey(answered, name) ? answered[name] : undefined;
    if (!isPlainObject(answer)) throw malformed(name);
    answers[name] = toAnswer(answer, question, name);
  }
  return {
    answers,
    usage: toUsage(response.usage),
    model: isString(response.model) ? response.model : '',
  };
}

/**
 * One answer as the flow reads it.
 * A `noul` carries no confidence, so ours is how far its probability sits from even, `|2p - 1|`.
 * That is the statistic a two-option `choice` reports, so one `below` threshold reads the same for both.
 */
function toAnswer(answer: WireAnswer, question: FlowQuestion, name: string): DecideAnswer {
  if ('yesNo' in question) {
    const probability = answer.noul;
    if (!isProbability(probability)) throw malformed(name);
    return {
      answer: probability >= 0.5 ? 'yes' : 'no',
      confidence: Math.abs(2 * probability - 1),
    };
  }
  const confidence = answer.confidence;
  if (!isProbability(confidence)) throw malformed(name);
  if ('choice' in question) {
    if (!isString(answer.choice) || !hasKey(question.choice, answer.choice)) throw malformed(name);
    return { answer: answer.choice, confidence };
  }
  const { score } = answer;
  if (!isNumber(score) || Number.isNaN(score)) throw malformed(name);
  const index = Math.min(question.score.length - 1, Math.max(0, Math.round(score)));
  return { answer: question.score[index], confidence };
}

/**
 * Whether `value` is a number from `0` to `1`.
 */
function isProbability(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

/**
 * The failure for a question the wire answered outside its options, or not at all.
 */
function malformed(name: string): Error {
  return providerError({
    code: 'malformed',
    message: `The answer to \`${name}\` is not one of its options`,
  });
}

function toUsage(usage: WireResponse['usage']): Usage {
  return {
    fresh: usage?.input_tokens ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: usage?.output_tokens ?? 0,
  };
}
