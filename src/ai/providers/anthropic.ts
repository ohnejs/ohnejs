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
import { drain, endedEarly, parseJSON, postEvents } from './_wire.ts';
import { DEFAULT_MAX_OUTPUT, providerError } from './provider.ts';

interface WireUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

interface RedactedBlock {
  type: 'redacted_thinking';
  data: string;
}

type Block = TextBlock | ToolUseBlock | ThinkingBlock | RedactedBlock;

type Delta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string };

type WireEvent =
  | { type: 'message_start'; message: { model: string; usage: WireUsage } }
  | { type: 'content_block_start'; index: number; content_block: Block }
  | { type: 'content_block_delta'; index: number; delta: Delta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: WireUsage }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } }
  | { type: 'ping' };

interface Message {
  blocks: Block[];
  stop: StopReason;
  usage: WireUsage;
  model: string;
}

const API = 'https://api.anthropic.com';
const VERSION = '2023-06-01';
const CACHED = { cache_control: { type: 'ephemeral' } };

const STOPS: Record<string, StopReason> = {
  tool_use: 'calls',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  refusal: 'refusal',
};

/**
 * Builds the provider for the Anthropic Messages API.
 * Every call streams, so a failure after the `200` arrives as an `error` event and is rerun.
 * A `cache` block ends a cached prefix with a `cache_control` marker.
 * The transcript is the `messages` array, the assistant's turn replayed block for block.
 * The spend-cap `429` is never rerun.
 *
 * @example
 * ```ts
 * const provider = createAnthropicProvider({ model: 'claude-sonnet-4-5', key })
 * ```
 */
export function createAnthropicProvider(options: ProviderOptions): Provider {
  const url = `${withoutTrailingSlash(options.baseURL ?? API)}/v1/messages`;
  const headers = { 'x-api-key': options.key, 'anthropic-version': VERSION, ...options.headers };
  const post = (body: Record<string, unknown>, signal: AbortSignal) =>
    postEvents(url, { headers, body: merge(options.options, body), signal, billing });

  return {
    step(request, signal) {
      const body = {
        model: options.model,
        max_tokens: request.maxOutput ?? DEFAULT_MAX_OUTPUT,
        stream: true,
        system: toSystem(request.system),
        tools: request.tools.map(toTool),
        messages: request.transcript,
      };
      return retriedStream(async function* () {
        const { blocks, stop, usage, model } = yield* readMessage(await post(body, signal));
        yield {
          type: 'done',
          calls: blocks.filter((block) => block.type === 'tool_use').map(toCall),
          stop,
          usage: toUsage(usage),
          model,
          items: [{ role: 'assistant', content: blocks }],
        };
      }, signal);
    },

    complete(request, signal) {
      const body = {
        model: options.model,
        max_tokens: request.maxOutput ?? DEFAULT_MAX_OUTPUT,
        stream: true,
        system: toSystem(request.system),
        messages: [{ role: 'user', content: request.input }],
        output_config: { format: { type: 'json_schema', schema: request.schema } },
      };
      return retried(
        async () => toCompletion(await drain(readMessage(await post(body, signal)))),
        signal,
      );
    },

    transcript: {
      user: (text) => [{ role: 'user', content: text }],
      results: (results) => [
        {
          role: 'user',
          content: results.map((result) => ({
            type: 'tool_result',
            tool_use_id: result.id,
            content: result.content,
            ...(result.error ? { is_error: true } : {}),
          })),
        },
      ],
    },
  };
}

/**
 * Reads one message off its event stream, yielding each piece of text and returning the whole.
 * A `tool_use` block's input arrives as JSON fragments, joined and parsed when the block stops.
 */
async function* readMessage(events: AsyncIterable<SSEMessage>): AsyncGenerator<TextEvent, Message> {
  const blocks: Block[] = [];
  const partial: string[] = [];
  let usage: WireUsage = {};
  let model = '';
  let stop: string | null = null;
  for await (const { data } of events) {
    const event = parseJSON(data, 'An event') as WireEvent;
    switch (event.type) {
      case 'message_start':
        ({ usage, model } = event.message);
        break;
      case 'content_block_start':
        blocks[event.index] = event.content_block;
        partial[event.index] = '';
        break;
      case 'content_block_delta': {
        const block = blocks[event.index];
        const { delta } = event;
        if (delta.type === 'text_delta' && block.type === 'text') {
          block.text += delta.text;
          yield { type: 'text', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          partial[event.index] += delta.partial_json;
        } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
          block.thinking += delta.thinking;
        } else if (delta.type === 'signature_delta' && block.type === 'thinking') {
          block.signature = delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks[event.index];
        const json = partial[event.index];
        if (block.type === 'tool_use' && json !== '') block.input = toInput(json);
        break;
      }
      case 'message_delta':
        usage = { ...usage, ...event.usage };
        stop = event.delta.stop_reason ?? stop;
        break;
      case 'message_stop':
        return { blocks, stop: STOPS[stop ?? ''] ?? 'end', usage, model };
      case 'error':
        throw providerError({ code: 'stream', message: event.error.message, retry: true });
    }
  }
  throw endedEarly();
}

function billing(error: Record<string, unknown>): boolean {
  return (
    isPlainObject(error.details) && error.details.error_code === 'enforced_spend_limit_reached'
  );
}

function toSystem(blocks: PromptBlock[]): Record<string, unknown>[] {
  return blocks.map((block) => ({
    type: 'text',
    text: block.text,
    ...(block.cache ? CACHED : {}),
  }));
}

function toTool(tool: ToolDefinition): Record<string, unknown> {
  const { name, description, input, strict } = tool;
  return { name, description, input_schema: input, ...(strict ? { strict: true } : {}) };
}

function toInput(json: string): Record<string, unknown> {
  const input = parseJSON(json, 'A call input');
  if (!isPlainObject(input)) {
    throw providerError({ code: 'malformed', message: 'A call input is not an object' });
  }
  return input;
}

function toCall(block: ToolUseBlock): ToolCall {
  return { id: block.id, name: block.name, input: block.input };
}

function toUsage(usage: WireUsage): Usage {
  return {
    fresh: usage.input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
}

function toCompletion(message: Message): Completion {
  if (message.stop === 'refusal') {
    throw providerError({ code: 'refusal', message: 'The provider declined' });
  }
  if (message.stop === 'length') {
    throw providerError({ code: 'truncated', message: 'The answer was cut short' });
  }
  const text = message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return {
    value: parseJSON(text, 'The answer'),
    usage: toUsage(message.usage),
    model: message.model,
  };
}
