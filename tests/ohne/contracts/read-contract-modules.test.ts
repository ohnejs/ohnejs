import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readContractModules } from '../../../src/ohne/contracts/read-contract-modules.ts';
import { isOhneError, type OhneError } from '../../../src/ohne/error/ohne-error.ts';
import { relativePath } from '../../../src/utils/index.ts';

const ROUTES = "export interface Routes {\n  'GET /a': { response: string };\n}\n";

describe('readContractModules', () => {
  let root: string;
  let count = 0;

  function write(file: string, content: string): string {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
    return file;
  }

  function dir(): string {
    count += 1;
    return join(root, `case-${count}`);
  }

  async function refusal(entry: string): Promise<OhneError> {
    try {
      await readContractModules([entry]);
    } catch (error) {
      if (isOhneError(error)) return error;
      throw error;
    }
    throw new Error('expected a refusal');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-contract-modules-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies each module once and rewrites its type imports into aliases', async () => {
    const at = dir();
    const entry = write(
      join(at, 'ohne.contract.ts'),
      "import type { Row, Kind as K } from './types.ts';\n" +
        "import type * as T from './types.ts';\n" +
        "export type { Row } from './types.ts';\n" +
        "export type * as Shared from './types.ts';\n\n" +
        '/**\n * A detail.\n */\nexport interface Detail extends Row {\n  kind: K;\n  all: T.Kind;\n}\n\n' +
        ROUTES,
    );
    const types = write(
      join(at, 'types.ts'),
      "export interface Row {\n  id: string;\n}\n\nexport type Kind = 'a' | 'b';\n",
    );

    const modules = await readContractModules([entry], { app: entry });

    deepStrictEqual(
      modules.map(({ file, name }) => [file, name]),
      [
        [entry, 'Contract'],
        [types, 'M1'],
      ],
    );
    strictEqual(
      modules[0]!.text,
      '  import Row = M1.Row;\n' +
        '  import K = M1.Kind;\n' +
        '  import T = M1;\n' +
        '  export import Row = M1.Row;\n' +
        '  export import Shared = M1;\n\n' +
        '  /**\n   * A detail.\n   */\n  export interface Detail extends Row {\n    kind: K;\n    all: T.Kind;\n  }\n\n' +
        "  export interface Routes {\n    'GET /a': { response: string };\n  }",
    );
    strictEqual(
      modules[1]!.text,
      "  export interface Row {\n    id: string;\n  }\n\n  export type Kind = 'a' | 'b';",
    );
  });

  it('keeps the comments after a statement without a semicolon', async () => {
    const at = dir();
    write(join(at, 'a.ts'), 'export type A = 1;\n');
    const entry = write(
      join(at, 'ohne.contract.ts'),
      "import type { A } from './a.ts' // the a\n\n/**\n * The routes.\n */\n" + ROUTES,
    );

    const [contract] = await readContractModules([entry]);

    strictEqual(
      contract!.text.startsWith('  import A = M1.A; // the a\n\n  /**\n   * The routes.\n   */\n'),
      true,
    );
  });

  it('names further entries by layer and keeps a line inside a template literal exact', async () => {
    const at = dir();
    const base = write(join(at, 'base', 'ohne.contract.ts'), ROUTES);
    const app = write(
      join(at, 'app', 'ohne.contract.ts'),
      `export type Multi = \`a\n  b\${'c'}\n\`;\n\n${ROUTES}`,
    );

    const modules = await readContractModules([base, app], { app });

    deepStrictEqual(
      modules.map(({ name }) => name),
      ['L0', 'Contract'],
    );
    strictEqual(
      modules[1]!.text.startsWith("  export type Multi = `a\n  b${'c'}\n`;\n\n  export"),
      true,
    );
  });

  it('resolves a package import through Node', async () => {
    const at = dir();
    const pkg = join(at, 'packages', 'shared');
    write(join(pkg, 'package.json'), JSON.stringify({ name: 'shared', exports: { './*': './*' } }));
    const contract = write(join(pkg, 'contract.ts'), 'export type Kind = 1;\n');
    mkdirSync(join(at, 'node_modules'), { recursive: true });
    symlinkSync(pkg, join(at, 'node_modules', 'shared'), 'dir');
    const entry = write(
      join(at, 'ohne.contract.ts'),
      `import type { Kind } from 'shared/contract.ts';\n\n${ROUTES}`,
    );

    const modules = await readContractModules([entry]);

    strictEqual(modules[1]!.file, contract);
    strictEqual(modules[0]!.text.startsWith('  import Kind = M1.Kind;\n'), true);
  });

  it('refuses runtime code at its exact position, naming the value', async () => {
    const at = dir();
    const entry = write(
      join(at, 'ohne.contract.ts'),
      `${ROUTES}\nexport const MEMBER_ROLES = ['owner'] as const;\n`,
    );

    const error = await refusal(entry);

    strictEqual(
      error.title,
      `Contract module \`${relativePath(process.cwd(), entry)}\` holds runtime code`,
    );
    strictEqual(error.path, `${entry}:5:1`);
    deepStrictEqual(error.body, [
      "Its text is copied into your frontend's types file, so it may hold only types.",
      'Move `MEMBER_ROLES` into a runtime module and keep only its type here.',
    ]);
  });

  it('refuses a type modifier inside a value import, which leaves `import {}` behind', async () => {
    const at = dir();
    write(join(at, 'x.ts'), 'export type X = 1;\n');
    const entry = write(
      join(at, 'ohne.contract.ts'),
      `import { type X } from './x.ts';\n${ROUTES}`,
    );

    const error = await refusal(entry);

    strictEqual(error.path, `${entry}:1:1`);
    strictEqual(
      (error.body as string[])[1],
      'Write it as `import type` or `export type`, which leaves nothing behind.',
    );
  });

  it('refuses an enum the stripper cannot erase', async () => {
    const entry = write(join(dir(), 'ohne.contract.ts'), `${ROUTES}export enum Kind { A }\n`);

    const error = await refusal(entry);

    strictEqual(error.title?.endsWith('holds runtime code'), true);
    strictEqual(error.path, entry);
  });

  it('refuses what a namespace cannot carry, at its position', async () => {
    const cases: [string, string, string][] = [
      ['declare const x: number;\n', 'uses `declare`', '1:1'],
      ["import type X from './x.ts';\n", 'uses a default import', '1:1'],
      ["export type * from './x.ts';\n", 'uses `export type *`', '1:1'],
      ['type A = 1;\nexport type { A };\n', 'uses an export list', '2:1'],
      ['export default interface A {}\n', 'uses a default export', '1:1'],
      ["export type { X as default } from './x.ts';\n", 'uses a default export', '1:1'],
      ["export type * as default from './x.ts';\n", 'uses a default export', '1:1'],
      ["export type A = import('./x.ts').X;\n", 'uses an `import()` type', '1:17'],
    ];
    for (const [code, what, position] of cases) {
      const at = dir();
      write(join(at, 'x.ts'), 'export type X = 1;\nexport default interface D {}\n');
      const entry = write(join(at, 'ohne.contract.ts'), `${code}${ROUTES}`);

      const error = await refusal(entry);

      strictEqual(error.title?.endsWith(what), true, `${code} -> ${error.title}`);
      strictEqual(error.path, `${entry}:${position}`);
    }
  });

  it('keeps a method named `import` and a member named `declare`', async () => {
    const entry = write(
      join(dir(), 'ohne.contract.ts'),
      `export interface Tool {\n  import(x: string): void;\n  declare: boolean;\n}\n${ROUTES}`,
    );

    strictEqual((await readContractModules([entry])).length, 1);
  });

  it('refuses an import it cannot resolve or that is no `.ts` module', async () => {
    const at = dir();
    write(join(at, 'x.d.ts'), 'export type X = 1;\n');
    const missing = write(
      join(at, 'missing', 'ohne.contract.ts'),
      `import type { X } from 'nowhere';\n${ROUTES}`,
    );
    const declaration = write(
      join(at, 'ohne.contract.ts'),
      `import type { X } from './x.d.ts';\n${ROUTES}`,
    );

    const unresolved = await refusal(missing);
    strictEqual(unresolved.title, 'Cannot resolve `nowhere` in a contract module');
    strictEqual(unresolved.path, `${missing}:1:25`);

    const notTS = await refusal(declaration);
    strictEqual(notTS.title, 'Contract import `./x.d.ts` is not a `.ts` module');
  });

  it('names the importing site when an imported module refuses', async () => {
    const at = dir();
    const shared = write(join(at, 'shared.ts'), 'export const x = 1;\n');
    const entry = write(
      join(at, 'ohne.contract.ts'),
      `import type { X } from './shared.ts';\n${ROUTES}`,
    );

    const error = await refusal(entry);

    strictEqual(error.path, `${shared}:1:1`);
    strictEqual((error.body as string[]).at(-1)?.startsWith('It is imported at `'), true);
    strictEqual((error.body as string[]).at(-1)?.endsWith('ohne.contract.ts:1:1`.'), true);
  });

  it('refuses an entry that exports no `Routes`', async () => {
    const entry = write(join(dir(), 'ohne.contract.ts'), 'export type A = 1;\n');

    const error = await refusal(entry);

    strictEqual(error.title?.endsWith('exports no `Routes`'), true);
  });

  it('accepts `Routes` re-exported from another module', async () => {
    const at = dir();
    write(join(at, 'routes.ts'), ROUTES);
    const entry = write(
      join(at, 'ohne.contract.ts'),
      "export type { Routes } from './routes.ts';\n",
    );

    strictEqual((await readContractModules([entry])).length, 2);
  });
});
