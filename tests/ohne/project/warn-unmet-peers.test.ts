import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { useEnv, usePrinter, version } from '../../../src/ohne/index.ts';
import { warnUnmetPeers } from '../../../src/ohne/project/warn-unmet-peers.ts';
import { nextVersionLine, relativePath } from '../../../src/utils/index.ts';

const NEXT = nextVersionLine(version);

describe('warnUnmetPeers', () => {
  let root: string;
  let count = 0;

  /**
   * An app depending on one package per entry of `peers`, each declaring that `ohnejs` range.
   * A `null` range declares none; the app itself declares `own` when given.
   */
  function makeApp(peers: Record<string, string | null>, own?: string): string {
    const app = join(root, `app-${++count}`);
    const dependencies = Object.fromEntries(Object.keys(peers).map((name) => [name, '*']));
    const manifest = (name: string, peer: string | null | undefined) =>
      JSON.stringify({ name, ...(peer ? { peerDependencies: { ohnejs: peer } } : {}) });
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ ...JSON.parse(manifest('app', own)), dependencies }),
    );
    for (const [name, peer] of Object.entries(peers)) {
      const dir = join(app, 'node_modules', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), manifest(name, peer));
    }
    return app;
  }

  async function warned(app: string, running = version): Promise<string> {
    const out: string[] = [];
    usePrinter().configure({ stream: { write: (chunk) => out.push(chunk) } });
    try {
      await warnUnmetPeers(app, running);
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
    return out.join('');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-unmet-peers-')));
    useEnv().set('NO_COLOR', true);
  });

  after(() => {
    useEnv().unset('NO_COLOR');
    rmSync(root, { recursive: true, force: true });
  });

  it('stays quiet for a range that takes the running version, or a package with no range', async () => {
    strictEqual(await warned(makeApp({ fresh: `>=${version} <${NEXT}-0`, plain: null })), '');
  });

  it('warns for a range that ends before the running version, naming the package and its manifest', async () => {
    const app = makeApp({ stale: `>=0.0.1 <${version}-0` });
    const text = await warned(app);
    strictEqual(text.includes(`stale does not support ohne ${version}`), true);
    strictEqual(text.includes(`It supports ohne >=0.0.1 <${version}`), true);
    strictEqual(text.includes(`Install a release of stale that supports ohne ${version}`), true);
    const manifest = relativePath(
      process.cwd(),
      join(app, 'node_modules', 'stale', 'package.json'),
    );
    strictEqual(text.includes(manifest), true);
  });

  it('warns for a range that starts after the running version', async () => {
    const text = await warned(makeApp({ ahead: `>=${NEXT}` }));
    strictEqual(text.includes(`It supports ohne >=${NEXT} <${nextVersionLine(NEXT)}`), true);
  });

  it("reads a lone `>=` as ending at its floor's line", async () => {
    strictEqual(
      await warned(makeApp({ legacy: '>=0.0.1' })).then((t) => t.includes('<0.1.0')),
      true,
    );
  });

  it('warns for an exact range naming another version', async () => {
    const text = await warned(makeApp({ beta: `${NEXT}-beta.1` }));
    strictEqual(text.includes(`It supports only ohne ${NEXT}-beta.1.`), true);
  });

  it('leaves a range in any other shape to the package manager', async () => {
    strictEqual(await warned(makeApp({ caret: '^0.0.1', linked: 'workspace:*' })), '');
  });

  it("checks the app's own range, and gives each package its own block", async () => {
    const text = await warned(
      makeApp({ one: '>=0.0.1 <0.0.2-0', two: '>=0.0.1 <0.0.2-0' }, '>=0.0.1 <0.0.2'),
    );
    strictEqual(text.match(/does not support ohne/g)?.length, 3);
    strictEqual(text.indexOf('one does not') < text.indexOf('two does not'), true);
  });

  it('explains why a range leaves out the prerelease that runs', async () => {
    const app = makeApp({ line: '>=0.1.0 <0.2.0-0' });
    const rule = 'and a prerelease only when it names one of that version';
    strictEqual(await warned(app, '0.1.1'), '');
    strictEqual(
      (await warned(app, '0.1.1-beta.0')).includes(`ohne >=0.1.0 <0.2.0, ${rule}.`),
      true,
    );
    strictEqual((await warned(makeApp({ line: '>=0.0.1 <0.0.2-0' }))).includes(rule), false);
  });

  it('prints nothing for a silent project', async () => {
    useEnv().set('SILENT', true);
    try {
      strictEqual(await warned(makeApp({ stale: '>=0.0.1 <0.0.2-0' })), '');
    } finally {
      useEnv().unset('SILENT');
    }
  });
});
