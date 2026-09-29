import type { SSEMessage } from 'ohnejs/utils';

import {
  errorMessage,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  parseRetryAfter,
  parseSSE,
} from 'ohnejs/utils';

import type { ProviderError } from './provider.ts';

import { providerError } from './provider.ts';

/**
 * What `postEvents` sends.
 */
export interface PostOptions {
  /**
   * The provider's headers, credential included; `content-type` is set here.
   */
  headers: Record<string, string>;

  /**
   * The request body, sent as JSON.
   */
  body: unknown;

  /**
   * Aborts the request, the stream included.
   */
  signal: AbortSignal;

  /**
   * Whether the `error` object of a failed answer names a billing failure, which no wait resolves.
   */
  billing?: (error: Record<string, unknown>) => boolean;
}

/**
 * Statuses worth a rerun besides `5xx`: a timeout, a conflict, a rate limit.
 */
const RETRY_STATUSES = new Set([408, 409, 429]);

/**
 * Posts `body` and returns the events of the `text/event-stream` answer.
 * A request that gets no answer throws `network`, always retryable.
 * A status outside `2xx` throws `status`, retryable for `408`, `409`, `429` and `5xx`.
 * A failure `billing` recognizes is never retryable.
 * A connection lost while the events stream throws `stream`, retryable.
 * An aborted `signal` throws its reason.
 */
export async function postEvents(
  url: string,
  options: PostOptions,
): Promise<AsyncIterable<SSEMessage>> {
  const { headers, body, signal, billing } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    throw providerError({ code: 'network', message: networkMessage(error), retry: true });
  }
  if (!response.ok) throw await statusError(response, billing);
  if (isNull(response.body)) throw endedEarly();
  return events(response.body, signal);
}

/**
 * Runs a reader to its end and returns what it returned, dropping the text it yields.
 */
export async function drain<T>(reader: AsyncGenerator<unknown, T>): Promise<T> {
  for (let next = await reader.next(); ; next = await reader.next()) {
    if (next.done) return next.value;
  }
}

/**
 * The failure of a stream that closed before its final event.
 */
export function endedEarly(): ProviderError {
  return providerError({ code: 'stream', message: 'The answer ended early', retry: true });
}

/**
 * Parses JSON the provider promised, throwing `malformed` when it is not JSON.
 */
export function parseJSON(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw providerError({ code: 'malformed', message: `${what} is not JSON` });
  }
}

/**
 * Whether an OpenAI-shaped `error` names an exhausted quota, which Chat Completions servers echo.
 */
export function quotaExhausted(error: Record<string, unknown>): boolean {
  return error.code === 'insufficient_quota' || error.type === 'insufficient_quota';
}

/**
 * The `error` object of a failed answer, or an empty one when the body has none.
 */
function errorOf(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isPlainObject(parsed) && isPlainObject(parsed.error) ? parsed.error : {};
  } catch {
    return {};
  }
}

async function* events(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SSEMessage> {
  try {
    yield* parseSSE(body);
  } catch (error) {
    signal.throwIfAborted();
    throw providerError({ code: 'stream', message: networkMessage(error), retry: true });
  }
}

async function statusError(
  response: Response,
  billing: PostOptions['billing'],
): Promise<ProviderError> {
  const { status } = response;
  const error = errorOf(await response.text().catch(() => ''));
  const wait = parseRetryAfter(response.headers.get('retry-after')) ?? undefined;
  const retry = (RETRY_STATUSES.has(status) || status >= 500) && !billing?.(error);
  const message = isString(error.message) ? error.message : `Unexpected status ${status}`;
  return providerError({ code: 'status', message, status, retry, wait });
}

/**
 * The cause of a failed `fetch`, which Node wraps in a generic `fetch failed`.
 */
function networkMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  return errorMessage(isUndefined(cause) ? error : cause);
}
