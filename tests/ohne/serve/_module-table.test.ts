import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type Event, HTTPError, runWithEvent } from '../../../src/ohne/index.ts';
import {
  createModuleTable,
  type ModuleTable,
  type ScannedModule,
} from '../../../src/ohne/serve/_module-table.ts';
import { fingerprint } from '../../../src/utils/crypto/index.ts';

function makeEvent(url: string, headers: Record<string, string> = {}): Event {
  return {
    request: new Request(`http://localhost${url}`, { headers }),
    url: new URL(`http://localhost${url}`),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

function hashes(scanned: Map<string, ScannedModule>): Map<string, string> {
  return new Map([...scanned].map(([url, module]) => [url, module.hashed]));
}

function hashOf(source: string): string {
  return fingerprint(stripTypeScriptTypes(source));
}

describe('createModuleTable', () => {
  let dir: string;
  let count = 0;

  /**
   * A fresh pair of layer roots, closest first, with `files` written into them.
   */
  function layers(files: Record<string, string> = {}): [string, string] {
    const root = join(dir, `case-${count++}`);
    const near = join(root, 'near');
    const far = join(root, 'far');
    for (const [path, source] of Object.entries(files)) write(join(root, path), source);
    return [near, far];
  }

  function write(file: string, source: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-module-table-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('scan', () => {
    it('maps every module under a mount to its fingerprinted URL', async () => {
      const [near] = layers({
        'near/boot/runes.ts': 'export const rune: string = "Frost";\n',
        'near/pages/[id].mts': 'export default 1;\n',
        'near/assets/font.woff2': 'binary',
      });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      deepStrictEqual([...hashes(await table.scan())].toSorted(), [
        [
          '/m/app/boot/runes.ts',
          `/m/app/boot/runes.ts?h=${hashOf('export const rune: string = "Frost";\n')}`,
        ],
        ['/m/app/pages/[id].mts', `/m/app/pages/[id].mts?h=${hashOf('export default 1;\n')}`],
      ]);
    });

    it('records the specifiers each module imports at runtime', async () => {
      const [near] = layers({
        'near/a.ts': [
          "import type { Rune } from './types.ts';",
          "import { cast } from './cast.ts';",
          "export * from 'ohnejs/utils';",
          "export const later = () => import('app/pages/home.ts');",
        ].join('\n'),
      });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      deepStrictEqual((await table.scan()).get('/m/app/a.ts')?.imports.toSorted(), [
        './cast.ts',
        'app/pages/home.ts',
        'ohnejs/utils',
      ]);
    });

    it('skips a root that does not exist', async () => {
      const [near, far] = layers({ 'far/a.ts': 'export {};\n' });
      const table = createModuleTable([{ base: '/m/app', roots: [near, far] }]);
      deepStrictEqual([...hashes(await table.scan()).keys()], ['/m/app/a.ts']);
    });

    it('fingerprints the closer root, which serves the path', async () => {
      const [near, far] = layers({
        'near/a.ts': 'export const from = "near";\n',
        'far/a.ts': 'export const from = "far";\n',
      });
      const table = createModuleTable([{ base: '/m/app', roots: [near, far] }]);
      strictEqual(
        hashes(await table.scan()).get('/m/app/a.ts'),
        `/m/app/a.ts?h=${hashOf('export const from = "near";\n')}`,
      );
    });

    it('fingerprints a symlink in a closer root that shadows a deeper file', async () => {
      const [near, far] = layers({
        'far/a.ts': 'export const from = "far";\n',
        'elsewhere/a.ts': 'export const from = "link";\n',
      });
      mkdirSync(near);
      symlinkSync(join(near, '..', 'elsewhere', 'a.ts'), join(near, 'a.ts'));
      const table = createModuleTable([{ base: '/m/app', roots: [near, far] }]);
      strictEqual(
        hashes(await table.scan()).get('/m/app/a.ts'),
        `/m/app/a.ts?h=${hashOf('export const from = "link";\n')}`,
      );
    });

    it('follows edits, deletions and new shadows on the next scan', async () => {
      const [near, far] = layers({
        'far/a.ts': 'export const a = 1;\n',
        'far/b.ts': 'export const b = 1;\n',
        'far/c.ts': 'export const c = 1;\n',
      });
      const table = createModuleTable([{ base: '/m/app', roots: [near, far] }]);
      await table.scan();

      writeFileSync(join(far, 'a.ts'), 'export const a = 22;\n');
      unlinkSync(join(far, 'b.ts'));
      write(join(near, 'c.ts'), 'export const c = 3;\n');
      const hashed = hashes(await table.scan());

      strictEqual(hashed.get('/m/app/a.ts'), `/m/app/a.ts?h=${hashOf('export const a = 22;\n')}`);
      strictEqual(hashed.has('/m/app/b.ts'), false);
      strictEqual(hashed.get('/m/app/c.ts'), `/m/app/c.ts?h=${hashOf('export const c = 3;\n')}`);
    });

    it('picks up a same-size rewrite made right after a scan', async () => {
      const [near] = layers({ 'near/a.ts': 'export const a = 1;\n' });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      await table.scan();
      writeFileSync(join(near, 'a.ts'), 'export const a = 2;\n');
      strictEqual(
        hashes(await table.scan()).get('/m/app/a.ts'),
        `/m/app/a.ts?h=${hashOf('export const a = 2;\n')}`,
      );
    });

    it('keeps the fingerprint across a type-only edit or a touch', async () => {
      const [near] = layers({ 'near/a.ts': 'let a: string = 1;\n' });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      const before = hashes(await table.scan()).get('/m/app/a.ts');

      writeFileSync(join(near, 'a.ts'), 'let a: number = 1;\n');
      strictEqual(hashes(await table.scan()).get('/m/app/a.ts'), before);

      const { atime } = statSync(join(near, 'a.ts'));
      utimesSync(join(near, 'a.ts'), atime, new Date(0));
      strictEqual(hashes(await table.scan()).get('/m/app/a.ts'), before);
    });

    it('leaves out a module the stripper rejects', async () => {
      const [near] = layers({
        'near/school.ts': 'enum School { Frost }\n',
        'near/a.ts': 'export {};\n',
      });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      deepStrictEqual([...hashes(await table.scan()).keys()], ['/m/app/a.ts']);
    });

    it('fingerprints more modules than it reads at once', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 300; i++) files[`near/m${i}.ts`] = `export const n = ${i};\n`;
      const [near] = layers(files);
      const hashed = hashes(await createModuleTable([{ base: '/m/app', roots: [near] }]).scan());
      strictEqual(
        hashed.get('/m/app/m299.ts'),
        `/m/app/m299.ts?h=${hashOf('export const n = 299;\n')}`,
      );
      strictEqual(hashed.size, 300);
    });

    it('serves callers arriving mid-scan one later scan that sees their edits', async () => {
      const [near] = layers({ 'near/a.ts': 'export const a = 1;\n' });
      const table = createModuleTable([{ base: '/m/app', roots: [near] }]);
      const running = table.scan();
      writeFileSync(join(near, 'a.ts'), 'export const a = 22;\n');
      const [first, second] = [table.scan(), table.scan()];

      const joined = await first;
      strictEqual(joined, await second);
      strictEqual(joined === (await running), false);
      strictEqual(
        joined.get('/m/app/a.ts')?.hashed,
        `/m/app/a.ts?h=${hashOf('export const a = 22;\n')}`,
      );
    });
  });

  describe('send', () => {
    const source = 'export const school: string = "Arcane";\n';
    let roots: string[];
    let table: ModuleTable;
    let hash: string;

    async function send(url: string, headers: Record<string, string> = {}) {
      const event = makeEvent(url, headers);
      const path = new URL(url, 'http://localhost').pathname.slice('/m/app/'.length);
      const body = await runWithEvent(event, () => table.send(roots, path));
      return { body, status: event.response.status, headers: event.response.headers };
    }

    before(async () => {
      const [near] = layers({ 'near/spell.ts': source, 'near/school.ts': 'enum School {}\n' });
      roots = [near];
      table = createModuleTable([{ base: '/m/app', roots }]);
      await table.scan();
      hash = hashOf(source);
    });

    it('caches a module for good when the fingerprint names its bytes', async () => {
      const res = await send(`/m/app/spell.ts?h=${hash}`);
      strictEqual(res.body, stripTypeScriptTypes(source));
      strictEqual(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
      strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      strictEqual(res.headers.get('etag'), `"${hash}"`);
    });

    it('revalidates a module requested without or with a stale fingerprint', async () => {
      for (const url of ['/m/app/spell.ts', '/m/app/spell.ts?h=AAAAAAAA']) {
        const res = await send(url);
        strictEqual(res.body, stripTypeScriptTypes(source));
        strictEqual(res.headers.get('cache-control'), 'no-cache');
        strictEqual(res.headers.get('etag'), `"${hash}"`);
      }
    });

    it('answers 304 when the client holds these bytes', async () => {
      const res = await send('/m/app/spell.ts?h=AAAAAAAA', { 'if-none-match': `"${hash}"` });
      strictEqual(res.status, 304);
      strictEqual(res.body, undefined);
    });

    it('serves a module written after the last scan', async () => {
      writeFileSync(join(roots[0] as string, 'late.ts'), 'export const late = 1;\n');
      const res = await send('/m/app/late.ts');
      strictEqual(res.body, 'export const late = 1;\n');
      strictEqual(res.headers.get('cache-control'), 'no-cache');
    });

    it('answers 404 for a path no root holds', async () => {
      await rejects(
        send('/m/app/missing.ts'),
        (error) => error instanceof HTTPError && error.status === 404,
      );
    });

    it('throws the strip error of a module the stripper rejects', async () => {
      await rejects(send('/m/app/school.ts'), { code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' });
    });
  });
});
