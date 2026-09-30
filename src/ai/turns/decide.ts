import type { FlowDecide, FlowQuestion } from 'ohnejs';

import { hasKey, isNull, isNumber, isPlainObject, isString } from 'ohnejs/utils';

import type {
  CompleteRequest,
  DecideAnswer,
  Decider,
  Decision,
  Provider,
  Usage,
} from '../providers/provider.ts';

import { useAIConfig } from '../config.ts';
import { createJevProvider } from '../providers/jev.ts';
import { addUsage, providerError } from '../providers/provider.ts';
import { modelOptions, useProvider } from '../providers/use-provider.ts';

/**
 * How often a chat model is asked before its answer is given up on.
 */
const ATTEMPTS = 2;

/**
 * The `ai.models` entry that answers `decide`: its own `model`, else `ai.decide`, else the turn's `model`.
 *
 * @example
 * ```ts
 * decideModel({ questions }, 'smart') // -> 'router' under `ai: { decide: 'router' }`
 * decideModel({ questions }, 'smart') // -> 'smart' without `ai.decide`
 * ```
 */
export function decideModel(decide: FlowDecide, model: string): string {
  return decide.model ?? useAIConfig().decide ?? model;
}

/**
 * Builds the decider for the `ai.models` entry `name`, reading its key from the env at this call.
 * A `jev` entry answers natively; any other model answers by structured output on its `complete`.
 * Such an answer is checked against the questions and asked once more when it drifts.
 *
 * @example
 * ```ts
 * const { answers } = await useDecider('router').decide({ input, questions }, signal)
 * ```
 */
export function useDecider(name: string): Decider {
  const { entry, options } = modelOptions(name);
  return entry.provider === 'jev' ? createJevProvider(options) : structured(useProvider(name));
}

/**
 * A decider over a chat model: `ai.prompts.decide`, the questions and the message, one JSON answer.
 * The usage of every attempt is summed, since the provider bills each.
 */
function structured(provider: Provider): Decider {
  return {
    async decide(request, signal) {
      const { prompts } = useAIConfig();
      const call: CompleteRequest = {
        system: prompts.decide === '' ? [] : [{ text: prompts.decide, cache: true }],
        input: decideInput(request.input, request.questions),
        schema: decideSchema(request.questions),
      };
      let usage: Usage = { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      for (let attempt = 1; ; attempt++) {
        const completion = await provider.complete(call, signal);
        usage = addUsage(usage, completion.usage);
        const answers = readDecision(completion.value, request.questions);
        if (!isNull(answers)) return { answers, usage, model: completion.model } satisfies Decision;
        if (attempt >= ATTEMPTS) {
          throw providerError({
            code: 'malformed',
            message: 'The decision did not answer its questions',
          });
        }
      }
    },
  };
}

/**
 * The user message of a decision: the questions, then the message to judge.
 */
function decideInput(input: string, questions: Record<string, FlowQuestion>): string {
  const lines = Object.entries(questions).map(([name, question]) => questionLine(name, question));
  return ['# Questions', ...lines, '', '# Message', input].join('\n');
}

/**
 * One question as the model reads it.
 */
function questionLine(name: string, question: FlowQuestion): string {
  if ('choice' in question) {
    const options = Object.entries(question.choice).map(([option, text]) => `${option}: ${text}`);
    return `- ${name} (choice): ${options.join('; ')}`;
  }
  if ('score' in question) return `- ${name} (score, lowest first): ${question.score.join(', ')}`;
  return `- ${name} (yes or no): ${question.yesNo}`;
}

/**
 * The JSON Schema of a decision: one object per question, keyed by name.
 * A `choice` or `score` answers an option and a confidence; a `yesNo` the probability of yes.
 */
function decideSchema(questions: Record<string, FlowQuestion>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(questions)) {
    properties[name] =
      'yesNo' in question
        ? {
            type: 'object',
            properties: { probability: { type: 'number' } },
            required: ['probability'],
            additionalProperties: false,
          }
        : {
            type: 'object',
            properties: {
              answer: { type: 'string', enum: optionsOf(question) },
              confidence: { type: 'number' },
            },
            required: ['answer', 'confidence'],
            additionalProperties: false,
          };
  }
  return {
    type: 'object',
    properties,
    required: Object.keys(questions),
    additionalProperties: false,
  };
}

/**
 * The answers off a chat model's value, or `null` when it drifts from the questions.
 * It drifts on a missing or extra question, an answer outside its options, or a number outside `0` to `1`.
 * A `yesNo` reads as `yes` from a probability of a half up, its confidence how far from even it sits.
 */
function readDecision(
  value: unknown,
  questions: Record<string, FlowQuestion>,
): Record<string, DecideAnswer> | null {
  if (!isPlainObject(value) || Object.keys(value).length !== Object.keys(questions).length) {
    return null;
  }
  const answers: Record<string, DecideAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = hasKey(value, name) ? value[name] : undefined;
    if (!isPlainObject(answer)) return null;
    if ('yesNo' in question) {
      const { probability } = answer;
      if (!isProbability(probability)) return null;
      answers[name] = {
        answer: probability >= 0.5 ? 'yes' : 'no',
        confidence: Math.abs(2 * probability - 1),
      };
      continue;
    }
    const { answer: option, confidence } = answer;
    if (!isString(option) || !optionsOf(question).includes(option)) return null;
    if (!isProbability(confidence)) return null;
    answers[name] = { answer: option, confidence };
  }
  return answers;
}

/**
 * The options a `choice` or `score` question answers with.
 */
function optionsOf(question: Exclude<FlowQuestion, { yesNo: string }>): string[] {
  return 'choice' in question ? Object.keys(question.choice) : question.score;
}

/**
 * Whether `value` is a number from `0` to `1`.
 */
function isProbability(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}
