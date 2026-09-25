import type { Server } from 'node:http';

import type { Gate } from '../../utils/index.ts';

import { isUndefined, sleep } from '../../utils/index.ts';

/**
 * Options for `shutdownServer`.
 */
export interface ShutdownServerOptions {
  /**
   * How long to keep serving before refusing connections, as a `parseDuration` value.
   * Buys the load balancer time to deregister this instance before it stops accepting.
   * Omitted means stop accepting at once.
   *
   * @example
   * ```ts
   * 5000    // 5 seconds, as raw milliseconds
   * '5s'    // 5 seconds
   * '500ms' // half a second
   * ```
   */
  preStopDelay?: number | string;

  /**
   * How long in-flight requests and their background work may take to drain, a `parseDuration` value.
   * When it expires, every request still in flight is cancelled, even one already answered.
   * Its connection closes and its `signal` aborts, so its handler or `waitUntil` work can stop.
   * Shutdown then waits for their cleanup, so work that ignores its signal holds shutdown open.
   * Keep it below the orchestrator's kill window, or it `SIGKILL`s mid-drain.
   * Omitted means wait indefinitely.
   *
   * @example
   * ```ts
   * 10000 // 10 seconds, as raw milliseconds
   * '10s' // 10 seconds
   * '1m'  // one minute
   * ```
   */
  shutdownTimeout?: number | string;
}

/**
 * Drains an HTTP server gracefully.
 *
 * After an optional pre-stop delay, it stops accepting new connections.
 * It then waits for in-flight requests and their `waitUntil` work to drain, bounded by `shutdownTimeout`.
 * Idle keep-alive sockets are closed so the server can settle.
 * If the wait times out, every request still in flight is cancelled, even one already answered.
 * Its connection closes and its `signal` aborts.
 * It then waits for their cleanup, which only the coordinator's `deadline` bounds.
 *
 * Register it with `onShutdown` so the coordinator runs it on a signal.
 *
 * @example
 * ```ts
 * const { server, gate } = createServer(router)
 * server.listen(3000)
 * onShutdown(() => shutdownServer(server, gate, { shutdownTimeout: '10s' }))
 * ```
 */
export async function shutdownServer(
  server: Server,
  gate: Gate,
  options: ShutdownServerOptions = {},
): Promise<void> {
  if (!isUndefined(options.preStopDelay)) await sleep(options.preStopDelay);

  server.close();
  const { drained } = await gate.close({ timeout: options.shutdownTimeout });

  server.closeIdleConnections();
  if (drained) return;
  server.closeAllConnections();
  gate.cancel(new DOMException('The server is shutting down', 'AbortError'));
  await gate.settled();
}
