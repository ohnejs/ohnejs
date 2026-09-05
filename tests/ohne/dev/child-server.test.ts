import { rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  type ChildExit,
  type ServeChild,
  spawnServeChild,
} from '../../../src/ohne/dev/child-server.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';

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

describe('spawnServeChild', () => {
  let root: string;
  let children: ServeChild[];

  function writeProject(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), 'export default { printer: { silent: true } }\n');
    return app;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-child-server-'));
    useEnv().set('SILENT', true);
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

    const first = spawnServeChild(app, 'api', { port, entry: BIN });
    children.push(first);
    await first.ready;
    await first.stop();

    const second = spawnServeChild(app, 'api', { port, entry: BIN });
    children.push(second);
    await second.ready;
    await second.stop();
  });

  it('rejects ready when the child exits before signalling ready', TIMEOUT, async () => {
    const app = writeProject('boot-fail');
    mkdirSync(join(app, 'boot'), { recursive: true });
    writeFileSync(join(app, 'boot', 'crash.ts'), 'process.exit(1)\n');

    const child = spawnServeChild(app, 'api', { entry: BIN });
    children.push(child);
    await rejects(child.ready);
  });

  it('rejects ready and kills a child that never signals ready', TIMEOUT, async () => {
    const app = writeProject('boot-hang');
    mkdirSync(join(app, 'boot'), { recursive: true });
    writeFileSync(
      join(app, 'boot', 'hang.ts'),
      'setInterval(() => {}, 60_000)\nawait new Promise(() => {})\n',
    );

    const child = spawnServeChild(app, 'api', { entry: BIN, readyTimeout: 500 });
    children.push(child);
    await rejects(child.ready, /did not signal ready within `500ms`/);
    await child.stop();
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
    const child = spawnServeChild(app, 'api', {
      port,
      entry: BIN,
      onExit: (exit) => resolveExit(exit),
    });
    children.push(child);

    await child.ready;
    strictEqual((await exited).code, 7);
  });
});
