import type { AddressInfo } from 'node:net';

import { ok, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { before, describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/index.ts';

import { createRouter, createServer, shutdownServer, usePrinter } from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

function makeRoute(pattern: string, handler: AnyHandler): Route {
  return { method: 'GET', pattern, file: `${pattern}.ts`, layer: 'test', handler };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await sleep(5);
}

before(() => {
  usePrinter().configure({ stream: { write() {} } });
});

describe('shutdownServer', () => {
  it('lets an in-flight request finish before resolving', async () => {
    let release!: () => void;
    const work = new Promise<void>((resolve) => (release = resolve));
    const route = makeRoute('/slow', async () => {
      await work;
      return 'done';
    });

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://localhost:${port}/slow`);
    await waitFor(() => gate.pending === 1);

    const shutdown = shutdownServer(server, gate, { shutdownTimeout: '2s' });
    release();

    const res = await inflight;
    strictEqual(await res.text(), 'done');
    await shutdown;
    strictEqual(gate.state, 'closed');
  });

  it('force-closes connections when the drain times out', async () => {
    const route = makeRoute('/hang', () => new Promise<string>(() => {}));

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://localhost:${port}/hang`).catch((error) => error);
    await waitFor(() => gate.pending === 1);

    await shutdownServer(server, gate, { shutdownTimeout: '50ms' });
    ok((await inflight) instanceof Error);
  });

  it('keeps serving through the pre-stop delay, then drains', async () => {
    const { server, gate } = createServer(createRouter([makeRoute('/', () => 'ok')]));
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const shutdown = shutdownServer(server, gate, { preStopDelay: '150ms', shutdownTimeout: '1s' });
    const res = await fetch(`http://localhost:${port}/`);
    strictEqual(await res.text(), 'ok');

    await shutdown;
    strictEqual(gate.state, 'closed');
  });
});
