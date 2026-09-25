import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ohneError } from '../error/ohne-error.ts';

/**
 * Starts listening and resolves with the bound address.
 * A port another process holds rejects with a block that names the port.
 * Any other bind error rejects as it is.
 */
export function listen(server: Server, port: number, host?: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void =>
      reject(
        error.code === 'EADDRINUSE'
          ? ohneError({
              title: `Port \`${port}\` is already in use`,
              body: ['Another process is listening on it.', 'Stop that process and try again.'],
            })
          : error,
      );
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(server.address() as AddressInfo);
    });
  });
}
