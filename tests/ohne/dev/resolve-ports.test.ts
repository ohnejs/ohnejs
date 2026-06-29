import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createServer, type Server } from 'node:net';
import { after, describe, it } from 'node:test';

import { resolveDevPorts } from '../../../src/ohne/dev/resolve-ports.ts';

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

/**
 * Finds a base where `base` through `base + 3` are all free.
 * A scenario occupies some of them and asserts the scan lands exactly where the spec says.
 */
async function freeRun(): Promise<number> {
  for (let base = 9300; base < 9300 + 256; base += 8) {
    if (
      (await free(base)) &&
      (await free(base + 1)) &&
      (await free(base + 2)) &&
      (await free(base + 3))
    ) {
      return base;
    }
  }
  throw new Error('no free run of ports');
}

async function occupy(port: number): Promise<void> {
  servers.push(await listen(port));
}

function collect(): { onBusy: (port: number) => void; busy: number[] } {
  const busy: number[] = [];
  return { onBusy: (port) => busy.push(port), busy };
}

describe('resolveDevPorts', () => {
  describe('with PORT set as the stack base', () => {
    it('gives the dashboard the base and the API the next port', async () => {
      const base = await freeRun();
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base, dashboard: 9000, api: 9001, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base, api: base + 1 });
      deepStrictEqual(busy, []);
    });

    it('bumps both when the base is taken, warning the base', async () => {
      const base = await freeRun();
      await occupy(base);
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base, dashboard: 9000, api: 9001, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base + 1, api: base + 2 });
      deepStrictEqual(busy, [base]);
    });

    it('keeps the dashboard and bumps the API when the sibling slot is taken', async () => {
      const base = await freeRun();
      await occupy(base + 1);
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base, dashboard: 9000, api: 9001, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base, api: base + 2 });
      deepStrictEqual(busy, [base + 1]);
    });

    it('ignores a taken port the scan never reaches', async () => {
      const base = await freeRun();
      await occupy(base + 2);
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base, dashboard: 9000, api: 9001, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base, api: base + 1 });
      deepStrictEqual(busy, []);
    });

    it('gives the API the base directly when the dashboard is off', async () => {
      const base = await freeRun();
      const ports = await resolveDevPorts({
        base,
        dashboard: 9000,
        api: 9001,
        serveDashboard: false,
      });
      strictEqual(ports.api, base);
    });
  });

  describe('without PORT, from config or defaults', () => {
    it('resolves the dashboard and API independently', async () => {
      const base = await freeRun();
      const ports = await resolveDevPorts({
        base: undefined,
        dashboard: base,
        api: base + 2,
        serveDashboard: true,
      });
      deepStrictEqual(ports, { dashboard: base, api: base + 2 });
    });

    it('bumps only the configured side that is taken, warning that port', async () => {
      const base = await freeRun();
      await occupy(base);
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base: undefined, dashboard: base, api: base + 2, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base + 1, api: base + 2 });
      deepStrictEqual(busy, [base]);
    });

    it('keeps the API off the dashboard when both configs collide', async () => {
      const shared = await freeRun();
      const ports = await resolveDevPorts({
        base: undefined,
        dashboard: shared,
        api: shared,
        serveDashboard: true,
      });
      strictEqual(ports.dashboard, shared);
      ok(ports.api > shared);
    });

    it('warns each busy port once when the overlapping scans both hit it', async () => {
      const base = await freeRun();
      await occupy(base);
      await occupy(base + 1);
      const { onBusy, busy } = collect();
      const ports = await resolveDevPorts(
        { base: undefined, dashboard: base, api: base + 1, serveDashboard: true },
        onBusy,
      );
      deepStrictEqual(ports, { dashboard: base + 2, api: base + 3 });
      deepStrictEqual(busy, [base, base + 1]);
    });
  });
});
