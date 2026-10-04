import type { FlowQuestion, OhneError } from 'ohnejs';

import { ohneError } from 'ohnejs';
import { hasKey, isUndefined } from 'ohnejs/utils';

/**
 * What one provider instance is built from: a `models` entry with its key already resolved.
 */
export interface ProviderOptions {
  /**
   * The model name as the provider's API takes it.
   */
  model: string;

  /**
   * The API key, sent as the provider's credential header.
   * Omitted, no credential is sent, for a local server or `headers` that carry their own.
   */
  key?: string;

  /**
   * The API's origin, with the path prefix the provider's own SDK expects.
   * Omitted, the provider's public API.
   */
  baseURL?: string;

  /**
   * Headers sent with every request, on top of the provider's own.
   */
  headers?: Record<string, string>;

  /**
   * Provider-native request fields, deep-merged under the fields the adapter sets.
   */
  options?: Record<string, unknown>;

  /**
   * The most tokens one answer may spend, reasoning and thinking included.
   * Raise it for a reasoning model or a thinking budget, staying under the model's own output limit.
   *
   * @default
   * 8192
   */
  maxOutput?: number;
}

/**
 * The tokens one provider call consumed, as the provider counts them.
 */
export interface Usage {
  /**
   * Input tokens neither read from nor written to the prompt cache.
   */
  fresh: number;

  /**
   * Input tokens served from the prompt cache.
   */
  cacheRead: number;

  /**
   * Input tokens written to the prompt cache.
   */
  cacheWrite: number;

  /**
   * Output tokens, reasoning included.
   */
  output: number;
}

/**
 * One block of the system prompt.
 */
export interface PromptBlock {
  /**
   * The block's text.
   */
  text: string;

  /**
   * Ends a cached prefix after this block, on a provider with explicit cache breakpoints.
   * A provider that caches by prefix on its own ignores it.
   */
  cache?: boolean;
}

/**
 * A tool the model may call during a step.
 */
export interface ToolDefinition {
  /**
   * The name the model calls it by.
   */
  name: string;

  /**
   * What the tool does and when to call it, as the model reads it.
   */
  description: string;

  /**
   * The JSON Schema of the call's input, an object schema.
   */
  input: Record<string, unknown>;

  /**
   * Whether the provider guarantees every call matches `input`.
   * A strict schema sets `additionalProperties: false` on every object and requires every property.
   *
   * @default
   * false
   */
  strict?: boolean;
}

/**
 * A call the model made in a step.
 */
export interface ToolCall {
  /**
   * The provider's id of the call, which its `ToolResult` echoes.
   */
  id: string;

  /**
   * The tool's name.
   */
  name: string;

  /**
   * The call's input, parsed.
   */
  input: Record<string, unknown>;
}

/**
 * The answer to a `ToolCall`.
 */
export interface ToolResult {
  /**
   * The id of the call it answers.
   */
  id: string;

  /**
   * The answer's text.
   */
  content: string;

  /**
   * Marks the answer as a failure, on a provider that tells them apart.
   */
  error?: boolean;
}

/**
 * One item of a provider-native transcript: a message or an output item as the provider's wire has it.
 */
export type TranscriptItem = Record<string, unknown>;

/**
 * Builds the transcript items of one provider, so a transcript is appended and never edited.
 * The assistant's own items arrive on the `done` event of the step that produced them.
 */
export interface Transcript {
  /**
   * The items carrying the person's words.
   */
  user(text: string): TranscriptItem[];

  /**
   * The items carrying the answers to a step's calls, in call order.
   */
  results(results: ToolResult[]): TranscriptItem[];
}

/**
 * Why a step ended.
 *
 * - `end`: the model finished its answer.
 * - `calls`: the model made calls and waits for their results.
 * - `length`: the answer was cut at the model's `maxOutput` or at the context window.
 * - `refusal`: the provider declined the request.
 */
export type StopReason = 'end' | 'calls' | 'length' | 'refusal';

/**
 * What one step sends to the model.
 */
export interface StepRequest {
  /**
   * The system prompt, block by block, in order.
   */
  system: PromptBlock[];

  /**
   * The tools the model may call.
   */
  tools: ToolDefinition[];

  /**
   * Every item so far, the person's words and results included, in the provider's own shape.
   */
  transcript: TranscriptItem[];
}

/**
 * A piece of the model's text as it streams.
 */
export interface TextEvent {
  /**
   * The event's kind.
   */
  type: 'text';

  /**
   * The next piece of the answer.
   */
  text: string;
}

/**
 * The step failed and starts over after `wait`.
 * The text streamed so far belongs to the failed run and is streamed again.
 */
export interface RetryEvent {
  /**
   * The event's kind.
   */
  type: 'retry';

  /**
   * Milliseconds until the rerun starts.
   */
  wait: number;
}

/**
 * The step ended.
 */
export interface DoneEvent {
  /**
   * The event's kind.
   */
  type: 'done';

  /**
   * The calls the model made, in order.
   * A step cut short may carry calls under a `stop` other than `calls`.
   */
  calls: ToolCall[];

  /**
   * Why the step ended.
   */
  stop: StopReason;

  /**
   * The tokens the step consumed.
   */
  usage: Usage;

  /**
   * The model that answered, as the provider names it.
   */
  model: string;

  /**
   * The assistant's items of this step, to append to the transcript before the next one.
   */
  items: TranscriptItem[];
}

/**
 * What a step streams: text as it arrives, a retry when a run fails, and one `done` at the end.
 */
export type StepEvent = TextEvent | RetryEvent | DoneEvent;

/**
 * A tool-less call that answers in one JSON value.
 */
export interface CompleteRequest {
  /**
   * The system prompt, block by block, in order.
   */
  system: PromptBlock[];

  /**
   * The one user message.
   */
  input: string;

  /**
   * The JSON Schema the answer matches: an object schema with `additionalProperties: false` throughout.
   * Every object lists every property in `required`.
   */
  schema: Record<string, unknown>;
}

/**
 * The answer to a `CompleteRequest`.
 */
export interface Completion {
  /**
   * The answer, parsed; the caller checks it against the schema it asked for.
   */
  value: unknown;

  /**
   * The tokens the call consumed.
   */
  usage: Usage;

  /**
   * The model that answered, as the provider names it.
   */
  model: string;
}

/**
 * The questions a decide node asks about one message.
 */
export interface DecideRequest {
  /**
   * The message to judge: what the person typed, and nothing a request answered.
   */
  input: string;

  /**
   * The questions by name, as the flow declares them.
   */
  questions: Record<string, FlowQuestion>;
}

/**
 * The answer to one question of a decide node.
 */
export interface DecideAnswer {
  /**
   * The option picked: a `choice` option, a `score` level, or `yes` and `no`.
   */
  answer: string;

  /**
   * How sure the model is, from `0` to `1`, which a branch's `below` threshold reads.
   */
  confidence: number;
}

/**
 * The answers to a `DecideRequest`.
 */
export interface Decision {
  /**
   * One answer per question, by name.
   */
  answers: Record<string, DecideAnswer>;

  /**
   * The tokens the call consumed.
   */
  usage: Usage;

  /**
   * The model that answered, as the provider names it.
   */
  model: string;
}

/**
 * One model that answers a decide node's questions.
 * A failure throws a `ProviderError`; an answer outside the questions' options throws `malformed`.
 */
export interface Decider {
  /**
   * Answers every question about the request's input, in one call.
   * Aborting `signal` rejects with the signal's reason.
   */
  decide(request: DecideRequest, signal: AbortSignal): Promise<Decision>;
}

/**
 * One model behind one API, with the key already resolved.
 * A failure throws a `ProviderError`.
 * A step the provider answered but cut short ends in a `done` that says so in its `stop`.
 * A step cut short inside a call's arguments throws `malformed` instead, since that call cannot be answered.
 * A rerun after a retryable failure happens inside, at most twice, and shows as a `retry` event.
 */
export interface Provider {
  /**
   * Streams one step of a conversation and ends with its `done`.
   * Aborting `signal` rejects the stream with the signal's reason.
   */
  step(request: StepRequest, signal: AbortSignal): AsyncIterable<StepEvent>;

  /**
   * Answers one request with a JSON value matching `request.schema`.
   * A refusal throws `refusal`; an answer cut at the model's `maxOutput` throws `truncated`.
   */
  complete(request: CompleteRequest, signal: AbortSignal): Promise<Completion>;

  /**
   * Builds transcript items in this provider's shape.
   */
  transcript: Transcript;
}

/**
 * Why a provider call failed.
 *
 * - `network`: the request never got an answer.
 * - `status`: the answer's status was not `2xx`; `status` carries it.
 * - `stream`: the provider accepted the request and failed while answering, or ended before the answer.
 * - `refusal`: the provider declined a `complete`.
 * - `truncated`: a `complete` was cut at the model's `maxOutput`.
 * - `malformed`: the answer was not what the wire promises, such as a call whose input is not JSON.
 */
export type ProviderErrorCode =
  | 'network'
  | 'status'
  | 'stream'
  | 'refusal'
  | 'truncated'
  | 'malformed';

/**
 * A provider failure.
 */
export interface ProviderError extends OhneError {
  /**
   * What failed.
   */
  code: ProviderErrorCode;

  /**
   * Whether a rerun may succeed.
   */
  retry: boolean;

  /**
   * The answer's status, set for `status`.
   */
  status?: number;

  /**
   * Milliseconds the provider asked to wait before a rerun, from its `Retry-After`.
   */
  wait?: number;
}

/**
 * What `providerError` takes.
 */
export interface ProviderErrorInit {
  /**
   * What failed.
   */
  code: ProviderErrorCode;

  /**
   * The provider's own words, or a fixed line when it gave none.
   */
  message: string;

  /**
   * Whether a rerun may succeed.
   *
   * @default
   * false
   */
  retry?: boolean;

  /**
   * The answer's status, for `status`.
   */
  status?: number;

  /**
   * Milliseconds the provider asked to wait before a rerun.
   */
  wait?: number;
}

const PROVIDER_ERROR = Symbol('ai.providerError');

/**
 * The most output tokens a step or a `complete` asks for when the model's entry names none.
 */
export const DEFAULT_MAX_OUTPUT = 8192;

/**
 * Builds the branded `ohneError` for a provider failure.
 *
 * @example
 * ```ts
 * throw providerError({ code: 'status', message: 'Overloaded', status: 529, retry: true })
 * ```
 */
export function providerError(init: ProviderErrorInit): ProviderError {
  const error = ohneError(init.message) as ProviderError;
  Object.defineProperty(error, PROVIDER_ERROR, { value: true });
  error.code = init.code;
  error.retry = init.retry ?? false;
  if (!isUndefined(init.status)) error.status = init.status;
  if (!isUndefined(init.wait)) error.wait = init.wait;
  return error;
}

/**
 * Whether `value` is a `ProviderError`.
 *
 * @example
 * ```ts
 * isProviderError(providerError({ code: 'network', message: 'fetch failed' })) // -> true
 * isProviderError(new Error('fetch failed'))                                  // -> false
 * ```
 */
export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof Error && hasKey(value, PROVIDER_ERROR);
}

/**
 * The tokens `usage` charges against a token limit.
 * A cache read costs a tenth of a fresh token, rounded up; a cache write costs a full one.
 *
 * @example
 * ```ts
 * usageCost({ fresh: 100, cacheRead: 95, cacheWrite: 20, output: 30 }) // -> 160
 * ```
 */
export function usageCost(usage: Usage): number {
  return usage.fresh + usage.cacheWrite + usage.output + Math.ceil(usage.cacheRead / 10);
}

/**
 * The sum of two usages.
 *
 * @example
 * ```ts
 * addUsage(
 *   { fresh: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
 *   { fresh: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
 * )
 * // -> { fresh: 2, cacheRead: 2, cacheWrite: 3, output: 5 }
 * ```
 */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    fresh: a.fresh + b.fresh,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/**
 * A request's input as fresh tokens, estimated at four characters a token.
 * For a call that ended before the provider reported its usage, since the provider bills it all the same.
 *
 * @example
 * ```ts
 * estimatedUsage({ input: 'Translate' }) // -> { fresh: 6, cacheRead: 0, cacheWrite: 0, output: 0 }
 * ```
 */
export function estimatedUsage(request: unknown): Usage {
  return {
    fresh: Math.ceil(JSON.stringify(request).length / 4),
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
  };
}
