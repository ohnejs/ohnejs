import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

import pkg from '../../../package.json' with { type: 'json' };
import { readStarter, webRefusal, writeStarter } from '../../../src/ohne/cli/starter.ts';
import { tar } from '../../utils/tar/_tar.ts';
import { KEPT, starterTarball, WORKSPACE } from './_starter.ts';

const encoder = new TextEncoder();

/**
 * Whether `error` is an `ohneError` block titled by `title`.
 */
const titled =
  (title: RegExp) =>
  (error: { title?: string }): boolean =>
    title.test(error.title ?? '');

/**
 * Stubs `fetch` with `respond` for one `run`, returning the URLs it was asked for.
 */
async function withFetch(
  respond: () => Promise<Response>,
  run: () => Promise<unknown>,
): Promise<string[]> {
  const urls: string[] = [];
  const stub = mock.method(globalThis, 'fetch', (url: string) => {
    urls.push(String(url));
    return respond();
  });
  try {
    await run();
  } finally {
    stub.mock.restore();
  }
  return urls;
}

describe('webRefusal', () => {
  it('refuses npm, since the starters are pnpm workspaces', () => {
    deepStrictEqual(webRefusal('npm', '0.5.0'), {
      title: 'A website needs pnpm',
      body: ['The starters are pnpm workspaces.', '', 'Run it again without `--pm npm`.'],
    });
  });

  it('refuses a prerelease, which has no starter tag', () => {
    strictEqual(
      webRefusal(undefined, '0.5.0-rc.1')?.title,
      'Website starters follow stable releases',
    );
    strictEqual(
      webRefusal('pnpm', '1.0.0-beta.2')?.title,
      'Website starters follow stable releases',
    );
  });

  it('lets pnpm or no choice through on a stable version', () => {
    strictEqual(webRefusal('pnpm', '0.5.0'), undefined);
    strictEqual(webRefusal(undefined, '0.5.0'), undefined);
  });
});

describe('readStarter', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-starter-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a local tarball with its top folder stripped', async () => {
    const entries = await readStarter('nuxt', starterTarball(mkdtempSync(join(root, 'a-'))));

    deepStrictEqual(
      entries.map(({ path, type }) => `${type} ${path}`),
      [
        'file package.json',
        'file pnpm-workspace.yaml',
        'directory apps',
        'directory apps/web/content',
        'file .gitignore',
        'file apps/backend/package.json',
        'file apps/web/public/logo.bin',
      ],
    );
  });

  it('downloads the starter tag of this `ohnejs` version', async () => {
    const body = readFileSync(starterTarball(mkdtempSync(join(root, 'b-'))));
    let entries: unknown[] = [];
    const urls = await withFetch(
      async () => new Response(body),
      async () => (entries = await readStarter('next')),
    );

    deepStrictEqual(urls, [
      `https://codeload.github.com/ohnejs/next-starter/tar.gz/refs/tags/ohne-v${pkg.version}`,
    ]);
    strictEqual(entries.length, 7);
  });

  it('names the missing tag on a `404`', async () => {
    await withFetch(
      async () => new Response('Not Found', { status: 404 }),
      () =>
        rejects(
          readStarter('nuxt'),
          titled(new RegExp(`^The \`nuxt\` starter has no \`ohne-v${pkg.version}\` tag$`)),
        ),
    );
  });

  it('explains a network failure or another status with a retry hint', async () => {
    const offline = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    const failed = (cause: RegExp) => (error: { title?: string; body?: string[] }) =>
      error.title === 'Could not download the `nuxt` starter' &&
      cause.test(error.body![0]!) &&
      error.body!.at(-1) === 'Check your connection and run it again.';

    await withFetch(
      () => Promise.reject(offline),
      () => rejects(readStarter('nuxt'), failed(/ENOTFOUND/)),
    );
    await withFetch(
      async () => new Response('', { status: 503 }),
      () => rejects(readStarter('nuxt'), failed(/`503`/)),
    );
  });

  it('refuses an archive over the compressed cap, and stops reading it', async () => {
    const stray: unknown[] = [];
    const record = (reason: unknown): void => void stray.push(reason);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(randomBytes(64 * 1024));
      },
    });

    process.on('unhandledRejection', record);
    try {
      await withFetch(
        async () => new Response(endless),
        () => rejects(readStarter('nuxt'), titled(/^The `nuxt` starter is too large$/)),
      );
      for (let turn = 0; turn < 5; turn++) await setImmediate();
    } finally {
      process.off('unhandledRejection', record);
    }
    deepStrictEqual(stray, []);
    strictEqual(pulled < 100, true);
  });

  it('refuses an archive over the unpacked cap', async () => {
    const dir = mkdtempSync(join(root, 'c-'));
    const path = join(dir, 'bomb.tar.gz');
    const zeros = new Uint8Array(21 * 1024 * 1024);
    writeFileSync(path, gzipSync(tar({ name: 'top/zeros.bin', data: zeros })));

    strictEqual(statSync(path).size < 1024 * 1024, true);
    await rejects(readStarter('nuxt', path), titled(/^The `nuxt` starter is too large$/));
  });

  it('refuses a local tarball over the compressed cap', async () => {
    const path = join(mkdtempSync(join(root, 'd-')), 'big.tar.gz');
    writeFileSync(path, randomBytes(5 * 1024 * 1024 + 1));

    await rejects(readStarter('nuxt', path), titled(/^The `nuxt` starter is too large$/));
  });

  it('refuses an archive that is not gzip, or holds a link or a climbing path', async () => {
    const dir = mkdtempSync(join(root, 'e-'));
    const cases = {
      'plain.tar.gz': tar({ name: 'top/a', data: 'a' }),
      'link.tar.gz': gzipSync(tar({ name: 'top/link', type: '2' })),
      'climb.tar.gz': gzipSync(tar({ name: 'top/../../escape', data: 'x' })),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      writeFileSync(join(dir, name), bytes);
      await rejects(
        readStarter('nuxt', join(dir, name)),
        titled(/^The `nuxt` starter is not a valid archive$/),
        name,
      );
    }
  });
});

describe('writeStarter', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-write-starter-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes the fixture starter, or `entries`, into a fresh directory and returns it.
   */
  async function written(
    entries?: Parameters<typeof writeStarter>[2],
    name = 'my-site',
  ): Promise<string> {
    const dir = mkdtempSync(join(root, 'site-'));
    const files =
      entries ?? (await readStarter('nuxt', starterTarball(mkdtempSync(join(root, 'tar-')))));
    await writeStarter(dir, name, files);
    return dir;
  }

  it('names the root package and keeps its other fields', async () => {
    const dir = await written();

    strictEqual(
      readFileSync(join(dir, 'package.json'), 'utf8'),
      '{\n  "name": "my-site",\n  "private": true\n}\n',
    );
  });

  it('drops `minimumReleaseAgeExclude` from the workspace', async () => {
    const dir = await written();

    strictEqual(
      readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'),
      'packages:\n  - apps/*\n\ncatalog:\n  ohnejs: 0.4.0\n',
    );
    strictEqual(WORKSPACE.includes('minimumReleaseAgeExclude'), true);
  });

  it('writes every other file byte for byte, and empty directories', async () => {
    const dir = await written();

    for (const [path, data] of Object.entries(KEPT)) {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      deepStrictEqual(new Uint8Array(readFileSync(join(dir, path))), bytes, path);
    }
    deepStrictEqual(readdirSync(join(dir, 'apps/web/content')), []);
  });

  it('drops the block wherever it sits, with one blank line between what remains', async () => {
    const cases: [string, string][] = [
      ['a: 1\n\nminimumReleaseAgeExclude:\n  - x\n\nb: 2\n', 'a: 1\n\nb: 2\n'],
      ['minimumReleaseAgeExclude: [x]\n\nb: 2\n', 'b: 2\n'],
      ['a: 1\nminimumReleaseAgeExclude:\n- x\n- y\nb: 2\n', 'a: 1\nb: 2\n'],
      ['a: 1\n', 'a: 1\n'],
    ];
    for (const [yaml, expected] of cases) {
      const file = {
        path: 'pnpm-workspace.yaml',
        type: 'file' as const,
        data: encoder.encode(yaml),
      };
      const dir = await written([file]);
      strictEqual(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), expected, yaml);
    }
  });

  it("names the backend's session cookie after the project, below its layers", async () => {
    const config = "export default defineConfig({\n  layers: ['ohnejs/base'],\n  cms: {},\n});\n";
    const odd = 'export default defineConfig({ layers: [] });\n';
    const dir = await written([
      { path: 'apps/backend/ohne.config.ts', type: 'file', data: encoder.encode(config) },
    ]);
    strictEqual(
      readFileSync(join(dir, 'apps/backend/ohne.config.ts'), 'utf8'),
      "export default defineConfig({\n  layers: ['ohnejs/base'],\n" +
        '  // Two apps on one host share cookies, so each names its own session cookie.\n' +
        "  auth: { cookieName: 'my-site-session' },\n  cms: {},\n});\n",
    );
    const kept = await written([
      { path: 'apps/backend/ohne.config.ts', type: 'file', data: encoder.encode(odd) },
    ]);
    strictEqual(readFileSync(join(kept, 'apps/backend/ohne.config.ts'), 'utf8'), odd);
  });

  it('transforms a `package.json` or `pnpm-workspace.yaml` only at the root', async () => {
    const data = encoder.encode('{ "name": "web" }\n');
    const yaml = encoder.encode('minimumReleaseAgeExclude:\n  - ohnejs\n');
    const dir = await written([
      { path: 'apps/web/package.json', type: 'file', data },
      { path: 'apps/web/pnpm-workspace.yaml', type: 'file', data: yaml },
    ]);

    deepStrictEqual(new Uint8Array(readFileSync(join(dir, 'apps/web/package.json'))), data);
    deepStrictEqual(new Uint8Array(readFileSync(join(dir, 'apps/web/pnpm-workspace.yaml'))), yaml);
  });

  it('refuses a path that leaves the project', async () => {
    await rejects(
      written([{ path: '../escape.txt', type: 'file', data: encoder.encode('x') }]),
      /leaves the project/,
    );
    strictEqual(readdirSync(root).includes('escape.txt'), false);
  });

  it('shows a path from the archive exactly', async () => {
    await rejects(written([{ path: '/a`b\x1b[31m', type: 'file', data: encoder.encode('x') }]), {
      message: 'The starter path ``/a`b\\x1B[31m`` leaves the project',
    });
  });
});
