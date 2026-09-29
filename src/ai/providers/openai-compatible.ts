import type { SSEMessage } from 'ohnejs/utils';

import { isNull, isPlainObject, merge, withoutTrailingSlash } from 'ohnejs/utils';

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
import { drain, endedEarly, parseJSON, postEvents, quotaExhausted } from './_wire.ts';
import { DEFAULT_MAX_OUTPUT, providerError } from './provider.ts';

type WireUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

type CallDelta = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type Chunk = {
  model?: string;
  choices?: {
    delta: { content?: string | null; refusal?: string | null; tool_calls?: CallDelta[] | null };
    finish_reason: string | null;
  }[];
  usage?: WireUsage | null;
  error?: { message?: string } | null;
};

type WireCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

interface Answer {
  text: string;
  refusal: string;
  calls: WireCall[];
  finish: string | null;
  usage: WireUsage;
  model: string;
}

const API = 'https://api.openai.com/v1';
const ANSWER = 'answer';

/**
 * Builds the provider for a Chat Completions API, the surface most model servers speak.
 * The transcript is the `messages` array after the system message.
 * The assistant's turn is replayed as one message with its `tool_calls`.
 * A call's arguments arrive as fragments keyed by `index`, joined and parsed at the end.
 * Usage rides on the final chunk, which `stream_options.include_usage` asks for.
 * The prompt is cached by prefix on the server's side, so `cache` on a block changes nothing.
 * A `429` for an exhausted quota is never rerun.
 *
 * @example
 * ```ts
 * const provider = createOpenAICompatibleProvider({
 *   model: 'llama3.3',
 *   key,
 *   baseURL: 'http://localhost:11434/v1',
 * })
 * ```
 */
export function createOpenAICompatibleProvider(options: ProviderOptions): Provider {
  const url = `${withoutTrailingSlash(options.baseURL ?? API)}/chat/completions`;
  const headers = { authorization: `Bearer ${options.key}`, ...options.headers };
  const post = (body: Record<string, unknown>, signal: AbortSignal) =>
    postEvents(url, {
      headers,
      body: merge(options.options, body),
      signal,
      billing: quotaExhausted,
    });

  return {
    step(request, signal) {
      const body = {
        model: options.model,
        max_tokens: request.maxOutput ?? DEFAULT_MAX_OUTPUT,
        stream: true,
        stream_options: { include_usage: true },
        messages: [toSystem(request.system), ...request.transcript],
        ...(request.tools.length > 0 ? { tools: request.tools.map(toTool) } : {}),
      };
      return retriedStream(async function* () {
        const answer = yield* readAnswer(await post(body, signal));
        const calls = answer.calls.map(toCall);
        yield {
          type: 'done',
          calls,
          stop: toStop(answer, calls),
          usage: toUsage(answer.usage),
          model: answer.model,
          items: [
            {
              role: 'assistant',
              content: answer.text || null,
              ...(answer.calls.length > 0 ? { tool_calls: answer.calls } : {}),
            },
          ],
        };
      }, signal);
    },

    complete(request, signal) {
      const body = {
        model: options.model,
        max_tokens: request.maxOutput ?? DEFAULT_MAX_OUTPUT,
        stream: true,
        stream_options: { include_usage: true },
        messages: [toSystem(request.system), { role: 'user', content: request.input }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: ANSWER, schema: request.schema, strict: true },
        },
      };
      return retried(
        async () => toCompletion(await drain(readAnswer(await post(body, signal)))),
        signal,
      );
    },

    transcript: {
      user: (text) => [{ role: 'user', content: text }],
      results: (results) =>
        results.map((result) => ({
          role: 'tool',
          tool_call_id: result.id,
          content: result.content,
        })),
    },
  };
}

/**
 * Reads one answer off its chunk stream, yielding each piece of text and returning the whole.
 * The stream ends at `[DONE]`, or when it closes after a chunk named the finish reason.
 */
async function* readAnswer(events: AsyncIterable<SSEMessage>): AsyncGenerator<TextEvent, Answer> {
  const answer: Answer = { text: '', refusal: '', calls: [], finish: null, usage: {}, model: '' };
  for await (const { data } of events) {
    if (data === '[DONE]') return answer;
    const chunk = parseJSON(data, 'A chunk') as Chunk;
    if (isPlainObject(chunk.error)) {
      throw providerError({
        code: 'stream',
        message: chunk.error.message ?? 'The answer failed',
        retry: true,
      });
    }
    answer.model ||= chunk.model ?? '';
    if (isPlainObject(chunk.usage)) answer.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const { delta, finish_reason } = choice;
    if (delta.content) {
      answer.text += delta.content;
      yield { type: 'text', text: delta.content };
    }
    if (delta.refusal) answer.refusal += delta.refusal;
    for (const piece of delta.tool_calls ?? []) {
      const call = (answer.calls[piece.index] ??= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (piece.id) call.id = piece.id;
      call.function.name += piece.function?.name ?? '';
      call.function.arguments += piece.function?.arguments ?? '';
    }
    if (!isNull(finish_reason)) answer.finish = finish_reason;
  }
  if (!isNull(answer.finish)) return answer;
  throw endedEarly();
}

function toSystem(blocks: PromptBlock[]): Record<string, unknown> {
  return { role: 'system', content: blocks.map((block) => block.text).join('\n\n') };
}

function toTool(tool: ToolDefinition): Record<string, unknown> {
  const { name, description, input, strict } = tool;
  return {
    type: 'function',
    function: { name, description, parameters: input, ...(strict ? { strict: true } : {}) },
  };
}

function toCall(call: WireCall): ToolCall {
  const input = parseJSON(call.function.arguments, 'A call input');
  if (!isPlainObject(input)) {
    throw providerError({ code: 'malformed', message: 'A call input is not an object' });
  }
  return { id: call.id, name: call.function.name, input };
}

function toStop(answer: Answer, calls: ToolCall[]): StopReason {
  if (answer.finish === 'content_filter' || answer.refusal !== '') return 'refusal';
  if (answer.finish === 'length') return 'length';
  return calls.length > 0 ? 'calls' : 'end';
}

function toUsage(usage: WireUsage): Usage {
  const input = usage.prompt_tokens ?? 0;
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    fresh: input - cacheRead,
    cacheRead,
    cacheWrite: 0,
    output: usage.completion_tokens ?? 0,
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
  return {
    value: parseJSON(answer.text, 'The answer'),
    usage: toUsage(answer.usage),
    model: answer.model,
  };
}
