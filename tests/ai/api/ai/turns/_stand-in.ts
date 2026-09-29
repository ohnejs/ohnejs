import { parseSSE } from '../../../../../src/utils/sse/parse-sse.ts';
import { sse } from '../../../providers/_server.ts';

/**
 * One call the scripted model makes.
 */
export interface ScriptedCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * One event the turn routes streamed, its JSON payload parsed.
 */
export interface StreamedEvent {
  event: string;
  data: Record<string, unknown>;
}

type Frame = { event: string; data: unknown };

function start(): Frame {
  return {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 1 },
      },
    },
  };
}

function block(
  index: number,
  content_block: Record<string, unknown>,
  delta?: Record<string, unknown>,
): Frame[] {
  return [
    { event: 'content_block_start', data: { type: 'content_block_start', index, content_block } },
    ...(delta
      ? [{ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta } }]
      : []),
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
  ];
}

function end(stop_reason: string): Frame[] {
  return [
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason, stop_sequence: null },
        usage: { output_tokens: 12 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];
}

/**
 * An answer that says `text` and ends the turn.
 */
export function says(text: string): string {
  return sse([
    start(),
    ...block(0, { type: 'text', text: '' }, { type: 'text_delta', text }),
    ...end('end_turn'),
  ]);
}

/**
 * An answer that says `text`, then makes `calls`.
 */
export function calls(text: string, scripted: ScriptedCall[]): string {
  return sse([
    start(),
    ...block(0, { type: 'text', text: '' }, { type: 'text_delta', text }),
    ...scripted.flatMap(({ id, name, input }, index) =>
      block(
        index + 1,
        { type: 'tool_use', id, name, input: {} },
        { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      ),
    ),
    ...end('tool_use'),
  ]);
}

/**
 * An answer cut at its output cap.
 */
export function cut(text: string): string {
  return sse([
    start(),
    ...block(0, { type: 'text', text: '' }, { type: 'text_delta', text }),
    ...end('max_tokens'),
  ]);
}

/**
 * A `400` the provider answers, which no rerun repairs.
 */
export const REFUSED = {
  status: 400,
  body: '{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}',
};

/**
 * Reads every event of a turn route's stream, until the step ends and the stream closes.
 */
export async function readEvents(response: Response): Promise<StreamedEvent[]> {
  const events: StreamedEvent[] = [];
  for await (const message of parseSSE(response.body as ReadableStream<Uint8Array>)) {
    events.push({
      event: message.event,
      data: JSON.parse(message.data) as Record<string, unknown>,
    });
  }
  return events;
}
