import { strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { generateContracts } from '../../../src/ohne/codegen/generate-contracts.ts';
import { generateProject, loadLayers, useLayers } from '../../../src/ohne/index.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');
const TSC = join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc');

describe('generateContracts', () => {
  let root: string;

  function write(file: string, content: string): void {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(join(app, 'node_modules', '@types'), { recursive: true });
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    write(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    write(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohnejs/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      join(app, 'ohne.config.ts'),
      "import { defineConfig } from 'ohnejs';\n\n" +
        "export default defineConfig({\n  layers: ['ohnejs/base'],\n  disable: { routes: ['GET /auth/install'] },\n});\n",
    );
    const handlers: Record<string, string> = {
      sites: "async () => [{ code: 'a', createdAt: new Date() }]",
      page: "() => '<p>Hi</p>'",
      loose: '() => ({ value: 1 as unknown, items: [] as unknown[] })',
      note: '() => ({ note: undefined as string | undefined })',
      run: "() => ({ id: 'a', run: () => 1 })",
    };
    for (const [name, handler] of Object.entries(handlers)) {
      write(
        join(app, 'api', `${name}.get.ts`),
        `import { defineHandler } from 'ohnejs';\n\nexport default defineHandler(${handler});\n`,
      );
    }
    return app;
  }

  async function typecheck(app: string): Promise<string> {
    await loadLayers(app);
    await generateProject(app);
    try {
      execFileSync(process.execPath, [TSC, '-p', app, '--noErrorTruncation'], { encoding: 'utf8' });
      return '';
    } catch (error) {
      return (error as { stdout: string }).stdout;
    }
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-contracts-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('passes when every handler answers what the merged contracts declare', async () => {
    const app = writeApp('agrees');
    write(
      join(app, 'ohne.contract.ts'),
      'export interface Routes {\n' +
        "  'GET /sites': { response: { code: string; createdAt: string }[] };\n" +
        "  'GET /page': { response: Response };\n" +
        "  'GET /loose': { response: { value: unknown; items: unknown[] } };\n" +
        "  'GET /note': { response: { note?: string } };\n" +
        "  'GET /run': { response: { id: string } };\n" +
        "  'GET /auth/install': { response: { required: boolean } };\n}\n",
    );

    strictEqual(await typecheck(app), '');
  });

  it('fails with a sentence naming each drifted, unknown, and stray route', async () => {
    const app = writeApp('drifts');
    write(
      join(app, 'ohne.contract.ts'),
      'export interface Routes {\n' +
        "  'GET /sites': { response: { code: number }[] };\n" +
        "  'GET /page': { response: string };\n" +
        "  'GET /loose': { response: { value?: number; items: string[] } };\n" +
        "  'GET /note': { response: { note: string | undefined } };\n" +
        "  'GET /run': { response: { id: string; run: () => number } };\n" +
        "  'GET /auth/me': { response: { id: string } };\n" +
        "  'GET /nowhere': { response: string };\n" +
        "  'POST /auth/logout': { response: { ok: true }; extra: 1 };\n}\n",
    );

    const output = await typecheck(app);

    strictEqual(
      output.includes('"`GET /auth/me` answers what its contract does not declare"'),
      true,
      output,
    );
    for (const id of ['GET /sites', 'GET /page', 'GET /loose', 'GET /note', 'GET /run']) {
      strictEqual(
        output.includes(`\`${id}\` answers what its contract does not declare`),
        true,
        output,
      );
    }
    strictEqual(output.includes('"`GET /nowhere` names no route"'), true, output);
    strictEqual(
      output.includes(
        '"A contract declares `extra`, which is none of `response`, `body`, `query`"',
      ),
      true,
      output,
    );
  });

  it('removes the file once no layer has a contract', async () => {
    const app = join(root, 'none');
    write(join(app, 'package.json'), JSON.stringify({ name: 'none', type: 'module' }));
    write(join(app, 'ohne.config.ts'), '');
    write(join(app, 'ohne.contract.ts'), 'export interface Routes {}\n');
    await loadLayers(app);
    const file = await generateContracts(app);
    strictEqual(file, join(app, '.ohne', 'node', 'contracts.ts'));
    strictEqual(existsSync(file), true);

    rmSync(join(app, 'ohne.contract.ts'));

    strictEqual(await generateContracts(app), null);
    strictEqual(existsSync(file), false);
  });
});
