import type { AddressInfo } from 'node:net';

import { ok, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { before, describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/index.ts';

import {
  createRouter,
  createServer,
  shutdownServer,
  usePrinter,
  useRequest,
  waitUntil,
} from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

function makeRoute(pattern: string, handler: AnyHandler): Route {
  return { method: 'GET', pattern, file: `${pattern}.ts`, layer: 'test', handler };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !condition(); i++) await sleep(5);
  ok(condition(), 'waitFor timed out');
}

/**
 * Resolves once `signal` aborts.
 */
function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
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
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://127.0.0.1:${port}/slow`);
    await waitFor(() => gate.pending === 1);

    const shutdown = shutdownServer(server, gate, { shutdownTimeout: '2s' });
    release();

    const res = await inflight;
    strictEqual(await res.text(), 'done');
    await shutdown;
    strictEqual(gate.state, 'closed');
  });

  it('force-closes connections when the drain times out', async () => {
    const route = makeRoute('/hang', async () => {
      await aborted(useRequest().signal);
      throw new Error('cancelled');
    });

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://127.0.0.1:${port}/hang`).catch((error) => error);
    await waitFor(() => gate.pending === 1);

    await shutdownServer(server, gate, { shutdownTimeout: '50ms' });
    ok((await inflight) instanceof Error);
  });

  it("waits for a cancelled request's cleanup before resolving", async () => {
    let cleaned = false;
    const route = makeRoute('/siege', async () => {
      await aborted(useRequest().signal);
      await sleep(100);
      cleaned = true;
      throw new Error('cancelled');
    });

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://127.0.0.1:${port}/siege`).catch((error) => error);
    await waitFor(() => gate.pending === 1);

    await shutdownServer(server, gate, { shutdownTimeout: '50ms' });
    strictEqual(cleaned, true);
    strictEqual(gate.pending, 0);
    ok((await inflight) instanceof Error);
  });

  it('cancels `waitUntil` work still running after its response finished', async () => {
    let reason: unknown;
    const route = makeRoute('/ritual', () => {
      const { signal } = useRequest();
      waitUntil(aborted(signal).then(() => (reason = signal.reason)));
      return 'Medivh';
    });

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/ritual`);
    strictEqual(await res.text(), 'Medivh');
    strictEqual(gate.pending, 1);

    const winner = await Promise.race([
      shutdownServer(server, gate, { shutdownTimeout: '50ms' }).then(() => 'shutdown'),
      sleep(500).then(() => 'timer'),
    ]);
    strictEqual(winner, 'shutdown');
    strictEqual(gate.pending, 0);
    strictEqual((reason as DOMException).name, 'AbortError');
    strictEqual((reason as DOMException).message, 'The server is shutting down');
  });

  it("waits for a timed-out handler's cleanup before resolving", async () => {
    let cleaned = false;
    const route = makeRoute('/culling', async () => {
      await aborted(useRequest().signal);
      await sleep(100);
      cleaned = true;
      return 'Stratholme';
    });

    const { server, gate } = createServer(createRouter([route]), { handlerTimeout: '20ms' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/culling`);
    strictEqual(res.status, 503);
    await res.body?.cancel();

    await shutdownServer(server, gate, { shutdownTimeout: '50ms' });
    strictEqual(cleaned, true);
    strictEqual(gate.pending, 0);
  });

  it('a handler that ignores its signal holds shutdown past shutdownTimeout', async () => {
    const route = makeRoute('/hang', () => new Promise<string>(() => {}));

    const { server, gate } = createServer(createRouter([route]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const inflight = fetch(`http://127.0.0.1:${port}/hang`).catch((error) => error);
    await waitFor(() => gate.pending === 1);

    const winner = await Promise.race([
      shutdownServer(server, gate, { shutdownTimeout: '50ms' }).then(() => 'shutdown'),
      sleep(300).then(() => 'timer'),
    ]);
    strictEqual(winner, 'timer');
    strictEqual(gate.pending, 1);
    ok((await inflight) instanceof Error);
  });

  it('keeps serving through the pre-stop delay, then drains', async () => {
    const { server, gate } = createServer(createRouter([makeRoute('/', () => 'ok')]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const shutdown = shutdownServer(server, gate, { preStopDelay: '150ms', shutdownTimeout: '1s' });
    const res = await fetch(`http://127.0.0.1:${port}/`);
    strictEqual(await res.text(), 'ok');

    await shutdown;
    strictEqual(gate.state, 'closed');
  });
});
