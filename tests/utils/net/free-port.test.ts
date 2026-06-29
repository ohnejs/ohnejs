import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createServer, type Server } from 'node:net';
import { after, describe, it } from 'node:test';

import { freePort } from '../../../src/utils/net/index.ts';

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

/**
 * Finds a base where `base`, `base + 1`, and `base + 2` are all free.
 * A test occupies `base` and asserts the scan lands on a known offset.
 */
async function freeRun(): Promise<number> {
  for (let base = 9560; base < 9560 + 256; base += 4) {
    if ((await isFree(base)) && (await isFree(base + 1)) && (await isFree(base + 2))) return base;
  }
  throw new Error('no free run of ports');
}

describe('freePort', () => {
  const servers: Server[] = [];
  after(() => {
    for (const server of servers) server.close();
  });

  it('returns the preferred port when it is free', async () => {
    const seed = await freePort();
    const got = await freePort(seed);
    strictEqual(got, seed);
  });

  it('scans upward past a taken port', async () => {
    const seed = await freePort();
    servers.push(await occupy(seed));
    const got = await freePort(seed);
    ok(got > seed);
  });

  it('skips an excluded port even when it is free', async () => {
    const seed = await freePort();
    const got = await freePort(seed, { exclude: [seed] });
    ok(got > seed);
  });

  it('reports each taken port through onBusy, but not an excluded one', async () => {
    const base = await freeRun();
    servers.push(await occupy(base));
    const busy: number[] = [];
    const got = await freePort(base, { exclude: [base + 1], onBusy: (p) => busy.push(p) });
    strictEqual(got, base + 2);
    deepStrictEqual(busy, [base]);
  });

  it('asks the OS for any free port when preferred is 0', async () => {
    const got = await freePort(0);
    ok(got > 0);
  });

  it('rejects when the scan window is exhausted', async () => {
    const seed = await freePort();
    servers.push(await occupy(seed));
    await rejects(freePort(seed, { attempts: 1 }));
  });
});
