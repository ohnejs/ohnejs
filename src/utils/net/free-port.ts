import { createServer } from 'node:net';

import { isNull } from '../is/is-null.ts';
import { MAX_PORT } from '../is/is-port.ts';

/**
 * Options for `freePort`.
 */
export interface FreePortOptions {
  /**
   * Host interface to probe, matching the one the server will bind.
   * Omitted probes every interface, as binding without a host does.
   */
  host?: string;

  /**
   * Ports to treat as taken even when bindable, so siblings never land on the same one.
   *
   * @default
   * []
   */
  exclude?: Iterable<number>;

  /**
   * How many ports to try, scanning upward from `preferred`, before giving up.
   *
   * @default
   * 64
   */
  attempts?: number;

  /**
   * Called with each port found already in use while scanning, before moving to the next.
   * An excluded port is not reported, since it is skipped without probing.
   */
  onBusy?: (port: number) => void;
}

/**
 * Finds a free TCP port, scanning upward from `preferred` to the first one that binds.
 *
 * `preferred` of `0` asks the OS for any free ephemeral port instead of scanning.
 * Ports in `exclude` are skipped even when free, so a second call never collides with the first.
 * A port already taken is skipped; any other bind error rejects.
 *
 * There is a small race: the probe binds and closes, so another process could claim the port first.
 * This is fine for dev convenience; do not rely on it for exclusivity.
 *
 * @example
 * ```ts
 * await freePort(9000)                      // -> 9000 when free, else the next free port up
 * await freePort(9000, { exclude: [9001] }) // -> 9000, or skips 9001 while scanning
 * await freePort()                          // -> a random free port from the OS
 * ```
 */
export async function freePort(preferred = 0, options: FreePortOptions = {}): Promise<number> {
  const { host, attempts = 64, onBusy } = options;
  const exclude = new Set(options.exclude);

  if (preferred === 0) {
    for (let i = 0; i < attempts; i++) {
      const got = await probe(0, host);
      if (!isNull(got) && !exclude.has(got)) return got;
    }
    throw new Error('No free ephemeral port found');
  }

  for (let port = preferred; port < preferred + attempts && port <= MAX_PORT; port++) {
    if (exclude.has(port)) continue;
    const got = await probe(port, host);
    if (!isNull(got)) return got;
    onBusy?.(port);
  }
  throw new Error(`No free port found near \`${preferred}\``);
}

function probe(port: number, host?: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    });
    server.listen(port, host, () => {
      const { port: bound } = server.address() as { port: number };
      server.close(() => resolve(bound));
    });
  });
}
