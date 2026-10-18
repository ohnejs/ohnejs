import type { SSEMessage } from 'ohnejs/utils';

import {
  first,
  isEmpty,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  last,
  merge,
  withoutTrailingSlash,
} from 'ohnejs/utils';

import type {
  Completion,
  PromptBlock,
  Provider,
  ProviderOptions,
  StopReason,
  TextEvent,
  ToolCall,
  ToolDefinition,
  Usage,
} from './provider.ts';

import { retried, retriedStream } from './_retry.ts';
import { drain, endedEarly, parseJSON, postEvents } from './_wire.ts';
import { DEFAULT_MAX_OUTPUT, providerError } from './provider.ts';

type WireUsage = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
};

type WireCall = { id?: string; name: string; args?: unknown };

type Part = Record<string, unknown> & {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: WireCall;
};

type TextPart = Part & { text: string };

type Chunk = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: WireUsage | null;
  modelVersion?: string;
  error?: { message?: string } | null;
};

interface Answer {
  parts: Part[];
  finish: string | null;
  message?: string;
  blocked: boolean;
  usage: WireUsage;
  model: string;
}

const API = 'https://generativelanguage.googleapis.com';

const STOPS: Record<string, StopReason> = {
  MAX_TOKENS: 'length',
  CONTINUATION: 'length',
  SAFETY: 'refusal',
  RECITATION: 'refusal',
  LANGUAGE: 'refusal',
  BLOCKLIST: 'refusal',
  PROHIBITED_CONTENT: 'refusal',
  SPII: 'refusal',
  IMAGE_SAFETY: 'refusal',
  IMAGE_PROHIBITED_CONTENT: 'refusal',
  IMAGE_RECITATION: 'refusal',
  ESCALATION: 'refusal',
  PUP_LIMITED_DISABLED: 'refusal',
};

const MALFORMED: Record<string, string> = {
  MALFORMED_FUNCTION_CALL: 'A call is malformed',
  UNEXPECTED_TOOL_CALL: 'A call names no declared tool',
  MALFORMED_RESPONSE: 'The answer is malformed',
  MISSING_THOUGHT_SIGNATURE: 'A thought signature is missing',
};

/**
 * Builds the provider for the Gemini API's `streamGenerateContent`.
 * The transcript is the `contents` array, the model's turn replayed part for part.
 * Streamed text joins into one part, and a part carrying a thought signature stays as it came.
 * A call's response names its tool, and its id when the API gave one.
 * Gemini constrains calls only request-wide, so `strict` on a tool changes nothing.
 * The prompt is cached by prefix on the provider's side, so `cache` on a block changes nothing.
 * A `402` for a depleted prepaid balance is never rerun.
 *
 * @example
 * ```ts
 * const provider = createGeminiProvider({ model: 'gemini-3.8-flash', key })
 * ```
 */
export function createGeminiProvider(options: ProviderOptions): Provider {
  const base = withoutTrailingSlash(options.baseURL ?? API);
  const url = `${base}/v1beta/models/${options.model}:streamGenerateContent?alt=sse`;
  const key: Record<string, string> = isUndefined(options.key)
    ? {}
    : { 'x-goog-api-key': options.key };
  const headers = { ...key, ...options.headers };
  const cap = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
  const post = (body: Record<string, unknown>, signal: AbortSignal) =>
    postEvents(url, { headers, body: merge(options.options, body), signal });

  return {
    step(request, signal) {
      const body = {
        ...toSystem(request.system),
        contents: request.transcript,
        ...toTools(request.tools),
        generationConfig: { maxOutputTokens: cap },
      };
      return retriedStream(async function* () {
        const answer = yield* readAnswer(await post(body, signal));
        const calls = answer.parts.flatMap((part) =>
          part.functionCall ? [toCall(part.functionCall)] : [],
        );
        yield {
          type: 'done',
          calls,
          stop: toStop(answer, calls),
          usage: toUsage(answer.usage),
          model: answer.model,
          items: isEmpty(answer.parts) ? [] : [{ role: 'model', parts: answer.parts }],
        };
      }, signal);
    },

    complete(request, signal) {
      const body = {
        ...toSystem(request.system),
        contents: [{ role: 'user', parts: [{ text: request.input }] }],
        generationConfig: {
          maxOutputTokens: cap,
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: request.schema } },
        },
      };
      return retried(
        async () => toCompletion(await drain(readAnswer(await post(body, signal)))),
        signal,
      );
    },

    transcript: {
      user: (text) => [{ role: 'user', parts: [{ text }] }],
      results: (results) => [
        {
          role: 'user',
          parts: results.map((result) => ({
            functionResponse: {
              ...(isEmpty(result.id) ? {} : { id: result.id }),
              name: result.name,
              response: { [result.error ? 'error' : 'output']: result.content },
            },
          })),
        },
      ],
    },
  };
}

/**
 * Reads one answer off its chunk stream, yielding each piece of text and returning the whole.
 * The stream ends when it closes after a chunk named the finish reason, or after a blocked prompt.
 */
async function* readAnswer(events: AsyncIterable<SSEMessage>): AsyncGenerator<TextEvent, Answer> {
  const answer: Answer = { parts: [], finish: null, blocked: false, usage: {}, model: '' };
  for await (const { data } of events) {
    const chunk = parseJSON(data, 'A chunk') as Chunk;
    if (isPlainObject(chunk.error)) {
      throw providerError({
        code: 'stream',
        message: chunk.error.message ?? 'The answer failed',
        retry: true,
      });
    }
    answer.model ||= chunk.modelVersion ?? '';
    // Usage is cumulative within a stream, so the last one wins.
    if (isPlainObject(chunk.usageMetadata)) answer.usage = chunk.usageMetadata;
    if (chunk.promptFeedback?.blockReason) answer.blocked = true;
    const candidate = first(chunk.candidates ?? []);
    if (!candidate) continue;
    for (const part of candidate.content?.parts ?? []) {
      if (isString(part.text) && !isEmpty(part.text) && !part.thought) {
        yield { type: 'text', text: part.text };
      }
      gather(answer.parts, part);
    }
    if (candidate.finishReason) {
      answer.finish = candidate.finishReason;
      answer.message = candidate.finishMessage;
    }
  }
  if (isNull(answer.finish) && !answer.blocked) throw endedEarly();
  const failure = MALFORMED[answer.finish ?? ''];
  if (!isUndefined(failure)) {
    throw providerError({ code: 'malformed', message: answer.message ?? failure });
  }
  return answer;
}

/**
 * Appends a streamed part, joining plain text into the plain text before it of the same kind.
 */
function gather(parts: Part[], part: Part): void {
  if (plain(part) && isEmpty(part.text)) return;
  const previous = last(parts);
  if (
    !isUndefined(previous) &&
    plain(previous) &&
    plain(part) &&
    Boolean(previous.thought) === Boolean(part.thought)
  ) {
    previous.text += part.text;
  } else {
    parts.push(part);
  }
}

/**
 * Whether `part` is text and nothing else, its `thought` flag aside.
 */
function plain(part: Part): part is TextPart {
  return (
    isString(part.text) && Object.keys(part).every((key) => key === 'text' || key === 'thought')
  );
}

/**
 * The `systemInstruction` of a call, none for no blocks.
 */
function toSystem(blocks: PromptBlock[]): Record<string, unknown> {
  return isEmpty(blocks)
    ? {}
    : { systemInstruction: { parts: blocks.map((block) => ({ text: block.text })) } };
}

/**
 * The `tools` of a step, none for no tools.
 */
function toTools(tools: ToolDefinition[]): Record<string, unknown> {
  return isEmpty(tools) ? {} : { tools: [{ functionDeclarations: tools.map(toTool) }] };
}

function toTool(tool: ToolDefinition): Record<string, unknown> {
  const { name, description, input } = tool;
  return { name, description, parametersJsonSchema: input };
}

function toCall(call: WireCall): ToolCall {
  const input = call.args ?? {};
  if (!isPlainObject(input)) {
    throw providerError({ code: 'malformed', message: 'A call input is not an object' });
  }
  return { id: call.id ?? '', name: call.name, input };
}

function toStop(answer: Answer, calls: ToolCall[]): StopReason {
  if (answer.blocked) return 'refusal';
  return STOPS[answer.finish ?? ''] ?? (isEmpty(calls) ? 'end' : 'calls');
}

function toUsage(usage: WireUsage): Usage {
  const cacheRead = usage.cachedContentTokenCount ?? 0;
  return {
    fresh: (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0) - cacheRead,
    cacheRead,
    cacheWrite: 0,
    output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
}

function toCompletion(answer: Answer): Completion {
  const stop = toStop(answer, []);
  if (stop === 'refusal') {
    throw providerError({ code: 'refusal', message: 'The provider declined' });
  }
  if (stop === 'length') {
    throw providerError({ code: 'truncated', message: 'The answer was cut short' });
  }
  const text = answer.parts
    .filter((part) => isString(part.text) && !part.thought)
    .map((part) => part.text)
    .join('');
  return {
    value: parseJSON(text, 'The answer'),
    usage: toUsage(answer.usage),
    model: answer.model,
  };
}
