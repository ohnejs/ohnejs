import { ok, rejects, strictEqual } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { listen } from '../../../src/ohne/serve/_listen.ts';

/**
 * Closes `server`, resolving once it has stopped listening.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('listen', () => {
  it('resolves with the bound address', async () => {
    const server = createServer();
    try {
      const address = await listen(server, 0);
      strictEqual(address.port, (server.address() as AddressInfo).port);
      ok(address.port > 0);
    } finally {
      await close(server);
    }
  });

  it('rejects a taken port with a block that names the port', async () => {
    const stormwind = createServer();
    const { port } = await listen(stormwind, 0);
    const orgrimmar = createServer();
    try {
      await rejects(listen(orgrimmar, port), (error) => {
        ok(isOhneError(error));
        strictEqual(error.title, `Port \`${port}\` is already in use`);
        strictEqual(error.path, undefined);
        return true;
      });
      strictEqual(orgrimmar.listening, false);
    } finally {
      await close(stormwind);
    }
  });
});
