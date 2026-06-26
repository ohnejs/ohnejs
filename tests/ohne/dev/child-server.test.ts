import { rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  type APIChild,
  type ChildExit,
  spawnAPIChild,
} from '../../../src/ohne/dev/child-server.ts';

const BIN = fileURLToPath(new URL('../../../src/ohne/cli/bin.js', import.meta.url));
const TIMEOUT = { timeout: 20_000 };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe('spawnAPIChild', () => {
  let root: string;
  let children: APIChild[];

  function writeProject(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), 'export default { printer: { silent: true } }\n');
    return app;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-child-server-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    children = [];
  });

  afterEach(async () => {
    await Promise.all(children.map((child) => child.stop()));
  });

  it('signals ready and frees the port on stop', TIMEOUT, async () => {
    const app = writeProject('serves');
    const port = await freePort();

    const first = spawnAPIChild(app, { port, entry: BIN });
    children.push(first);
    await first.ready;
    await first.stop();

    const second = spawnAPIChild(app, { port, entry: BIN });
    children.push(second);
    await second.ready;
    await second.stop();
  });

  it('rejects ready when the child exits before signalling ready', TIMEOUT, async () => {
    const notApp = join(root, 'not-ohne');
    mkdirSync(notApp, { recursive: true });

    const child = spawnAPIChild(notApp, { entry: BIN });
    children.push(child);
    await rejects(child.ready);
  });

  it('calls onExit when a ready child exits on its own', TIMEOUT, async () => {
    const app = writeProject('self-exit');
    mkdirSync(join(app, 'boot'), { recursive: true });
    writeFileSync(join(app, 'boot', 'exit.ts'), 'setTimeout(() => process.exit(7), 300)\n');
    const port = await freePort();

    let resolveExit: (exit: ChildExit) => void;
    const exited = new Promise<ChildExit>((resolve) => {
      resolveExit = resolve;
    });
    const child = spawnAPIChild(app, { port, entry: BIN, onExit: (exit) => resolveExit(exit) });
    children.push(child);

    await child.ready;
    strictEqual((await exited).code, 7);
  });
});
