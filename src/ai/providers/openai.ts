import type { SSEMessage } from 'ohnejs/utils';

import { isPlainObject, merge, withoutTrailingSlash } from 'ohnejs/utils';

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
import { bearer, drain, endedEarly, parseJSON, postEvents, quotaExhausted } from './_wire.ts';
import { DEFAULT_MAX_OUTPUT, providerError } from './provider.ts';

type WireUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
};

type Part = { type: 'output_text'; text: string } | { type: 'refusal'; refusal: string };

type Item =
  | { type: 'message'; content: Part[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'reasoning' };

type WireResponse = {
  model: string;
  output: Item[];
  usage?: WireUsage | null;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
};

type WireEvent =
  | { type: 'response.output_text.delta'; delta: string }
  | { type: 'response.completed' | 'response.incomplete'; response: WireResponse }
  | { type: 'response.failed'; response: WireResponse }
  | { type: 'error'; message: string };

const API = 'https://api.openai.com/v1';
const ANSWER = 'answer';

/**
 * Builds the provider for the OpenAI Responses API.
 * Nothing is stored server-side: the transcript is the `input` array.
 * The assistant's output items are replayed as they came, encrypted reasoning included.
 * The prompt is cached by prefix on the provider's side, so `cache` on a block changes nothing.
 * A `429` for an exhausted quota is never rerun.
 *
 * @example
 * ```ts
 * const provider = createOpenAIProvider({ model: 'gpt-5', key })
 * ```
 */
export function createOpenAIProvider(options: ProviderOptions): Provider {
  const url = `${withoutTrailingSlash(options.baseURL ?? API)}/responses`;
  const headers = { ...bearer(options.key), ...options.headers };
  const cap = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
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
        max_output_tokens: cap,
        stream: true,
        store: false,
        include: ['reasoning.encrypted_content'],
        instructions: toInstructions(request.system),
        tools: request.tools.map(toTool),
        input: request.transcript,
      };
      return retriedStream(async function* () {
        const response = yield* readResponse(await post(body, signal));
        const calls = response.output.filter((item) => item.type === 'function_call').map(toCall);
        yield {
          type: 'done',
          calls,
          stop: toStop(response, calls),
          usage: toUsage(response.usage),
          model: response.model,
          items: response.output,
        };
      }, signal);
    },

    complete(request, signal) {
      const body = {
        model: options.model,
        max_output_tokens: cap,
        stream: true,
        store: false,
        instructions: toInstructions(request.system),
        input: [{ role: 'user', content: request.input }],
        text: {
          format: { type: 'json_schema', name: ANSWER, schema: request.schema, strict: true },
        },
      };
      return retried(
        async () => toCompletion(await drain(readResponse(await post(body, signal)))),
        signal,
      );
    },

    transcript: {
      user: (text) => [{ role: 'user', content: text }],
      results: (results) =>
        results.map((result) => ({
          type: 'function_call_output',
          call_id: result.id,
          output: result.content,
        })),
    },
  };
}

/**
 * Reads one response off its event stream, yielding each piece of text and returning the final response.
 */
async function* readResponse(
  events: AsyncIterable<SSEMessage>,
): AsyncGenerator<TextEvent, WireResponse> {
  for await (const { data } of events) {
    const event = parseJSON(data, 'An event') as WireEvent;
    switch (event.type) {
      case 'response.output_text.delta':
        yield { type: 'text', text: event.delta };
        break;
      case 'response.completed':
      case 'response.incomplete':
        return event.response;
      case 'response.failed':
        throw providerError({
          code: 'stream',
          message: event.response.error?.message ?? 'The response failed',
          retry: true,
        });
      case 'error':
        throw providerError({ code: 'stream', message: event.message, retry: true });
    }
  }
  throw endedEarly();
}

function toInstructions(blocks: PromptBlock[]): string {
  return blocks.map((block) => block.text).join('\n\n');
}

function toTool(tool: ToolDefinition): Record<string, unknown> {
  const { name, description, input, strict } = tool;
  return { type: 'function', name, description, parameters: input, strict: strict ?? false };
}

function toCall(item: Extract<Item, { type: 'function_call' }>): ToolCall {
  const input = parseJSON(item.arguments, 'A call input');
  if (!isPlainObject(input)) {
    throw providerError({ code: 'malformed', message: 'A call input is not an object' });
  }
  return { id: item.call_id, name: item.name, input };
}

function refused(response: WireResponse): boolean {
  return response.output.some(
    (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
  );
}

function toStop(response: WireResponse, calls: ToolCall[]): StopReason {
  const reason = response.incomplete_details?.reason;
  if (reason === 'content_filter' || refused(response)) return 'refusal';
  if (reason === 'max_output_tokens') return 'length';
  return calls.length > 0 ? 'calls' : 'end';
}

function toUsage(usage: WireUsage | null | undefined): Usage {
  const input = usage?.input_tokens ?? 0;
  const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0;
  return { fresh: input - cacheRead, cacheRead, cacheWrite: 0, output: usage?.output_tokens ?? 0 };
}

function toCompletion(response: WireResponse): Completion {
  const stop = toStop(response, []);
  if (stop === 'refusal') {
    throw providerError({ code: 'refusal', message: 'The provider declined' });
  }
  if (stop === 'length') {
    throw providerError({ code: 'truncated', message: 'The answer was cut short' });
  }
  const text = response.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content)
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('');
  return {
    value: parseJSON(text, 'The answer'),
    usage: toUsage(response.usage),
    model: response.model,
  };
}
