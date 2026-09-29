import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { once } from 'node:events';
import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';

/**
 * One scripted answer, given to requests in order.
 */
export interface Answer {
  /**
   * The status; `200` when omitted.
   */
  status?: number;

  /**
   * Headers on top of the content type, which is `text/event-stream` for a `200` and JSON otherwise.
   */
  headers?: Record<string, string>;

  /**
   * The body, written whole.
   */
  body?: string;

  /**
   * Keeps the answer open after `body` until the client leaves.
   */
  hold?: boolean;

  /**
   * Cuts the connection before any answer.
   */
  drop?: boolean;

  /**
   * Cuts the connection after `body`, mid-stream.
   */
  cut?: boolean;
}

/**
 * One request the server saw.
 */
export interface Seen {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/**
 * A provider stand-in on `127.0.0.1` that answers each request with the next scripted answer.
 */
export interface ProviderServer {
  /**
   * The origin, for a provider's `baseURL`.
   */
  url: string;

  /**
   * Every request, in order, its body parsed.
   */
  requests: Seen[];

  /**
   * How many held answers the client left.
   */
  left: number;

  /**
   * Queues answers for the next requests.
   */
  answer(...answers: Answer[]): void;

  /**
   * Stops the server.
   */
  close(): Promise<void>;
}

/**
 * Frames `events` as a `text/event-stream` body, each `data` as JSON.
 */
export function sse(events: { event?: string; data: unknown }[]): string {
  return events
    .map(
      ({ event, data }) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`,
    )
    .join('');
}

/**
 * Starts a provider stand-in; a request with no scripted answer gets a `500`.
 */
export async function startProviderServer(): Promise<ProviderServer> {
  const queue: Answer[] = [];
  const server = createServer(async (req, res) => {
    const body = JSON.parse((await text(req)) || '{}') as Record<string, unknown>;
    stand.requests.push({ path: req.url ?? '', headers: req.headers, body });
    const answer = queue.shift() ?? { status: 500, body: '{"error":{"message":"unscripted"}}' };
    if (answer.drop) {
      req.socket.destroy();
      return;
    }
    const status = answer.status ?? 200;
    res.writeHead(status, {
      'content-type': status === 200 ? 'text/event-stream' : 'application/json',
      ...answer.headers,
    });
    if (answer.cut) {
      res.write(answer.body ?? '', () => req.socket.destroy());
      return;
    }
    if (!answer.hold) {
      res.end(answer.body ?? '');
      return;
    }
    res.write(answer.body ?? '');
    res.on('close', () => {
      stand.left++;
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const stand: ProviderServer = {
    url: `http://127.0.0.1:${port}`,
    requests: [],
    left: 0,
    answer: (...answers) => {
      queue.push(...answers);
    },
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
  return stand;
}
