import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateRoles, loadLayers, useLayers } from '../../../src/ohne/index.ts';

describe('generateRoles', () => {
  let root: string;

  function writePackage(at: string, name: string, config = 'export default {};\n'): void {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeRole(dir: string, relative: string, capabilities: string[]): void {
    const file = join(dir, 'roles', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `export default { capabilities: ${JSON.stringify(capabilities)} };\n`);
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-roles-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  function bucket(paths: string[] | null, name: string): string {
    return readFileSync(paths!.find((path) => path.endsWith(`/.ohne/${name}/roles.ts`))!, 'utf8');
  }

  it('emits the shared name table, the `KnownRoles` extension, and registrations', async () => {
    const app = join(root, 'app');
    writePackage(app, 'app');
    writeRole(app, 'admin.ts', ['*']);
    writeRole(app, 'shop/manager.ts', ['collection.Products.*']);

    await loadLayers(app);
    const paths = await generateRoles(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('export interface GeneratedRoles {'), true);
    strictEqual(shared.includes('admin: true;'), true);
    strictEqual(shared.includes("'shop-manager': true;"), true);
    strictEqual(shared.includes('export type GeneratedRoleName ='), true);
    strictEqual(node.includes("import type { GeneratedRoles } from '../shared/roles.ts';"), true);
    strictEqual(node.includes("import { useRoles } from 'ohne';"), true);
    strictEqual(node.includes("import r0 from '../../roles/admin.ts';"), true);
    strictEqual(node.includes("import r1 from '../../roles/shop/manager.ts';"), true);
    strictEqual(node.includes('interface KnownRoles extends GeneratedRoles {}'), true);
    strictEqual(node.includes('const roles = useRoles();'), true);
    strictEqual(node.includes("roles.register('admin', { name: 'admin', role: r0 });"), true);
    strictEqual(
      node.includes("roles.register('shop-manager', { name: 'shop-manager', role: r1 });"),
      true,
    );
  });

  it('drops names in `disable.roles`', async () => {
    const app = join(root, 'disabled');
    writePackage(app, 'disabled', "export default { disable: { roles: ['admin'] } };\n");
    writeRole(app, 'admin.ts', ['*']);
    writeRole(app, 'editor.ts', ['collection.Posts.read']);

    await loadLayers(app);
    const paths = await generateRoles(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('editor: true;'), true);
    strictEqual(shared.includes('admin'), false);
    strictEqual(node.includes('admin'), false);
  });

  it('emits an empty interface when there are no roles', async () => {
    const app = join(root, 'empty');
    writePackage(app, 'empty');

    await loadLayers(app);
    const paths = await generateRoles(app);
    strictEqual(
      bucket(paths, 'shared'),
      `${BANNER}\n` +
        'export interface GeneratedRoles {}\n' +
        '\n' +
        'export type GeneratedRoleName = [keyof GeneratedRoles] extends [never] ? string : keyof GeneratedRoles;\n',
    );
    strictEqual(
      bucket(paths, 'node'),
      `${BANNER}\n` +
        "import type { GeneratedRoles } from '../shared/roles.ts';\n" +
        '\n' +
        "declare module 'ohne' {\n" +
        '  interface KnownRoles extends GeneratedRoles {}\n' +
        '}\n',
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateRoles(join(root, 'nowhere')), null);
  });
});
