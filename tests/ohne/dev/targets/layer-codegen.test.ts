import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createLayerCodegenTarget } from '../../../../src/ohne/dev/targets/layer-codegen.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

const ohne = new URL('../../../../src/ohne/index.ts', import.meta.url).href;

describe('layer codegen target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(join(app, 'collections'), { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    writeFileSync(
      join(app, 'ohne.layer.ts'),
      `import { useCollections } from '${ohne}';\n` +
        "export default { codegen: [{ path: () => 'fields.txt', code: ({ fresh }) =>\n" +
        "  `${fresh} ${Object.keys(useCollections().get('Posts')?.collection.fields ?? {})}` }] };\n",
    );
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-layer-codegen-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('is never affected by a changed path', async () => {
    const app = writeApp('unaffected');
    await loadLayers(app);
    const target = createLayerCodegenTarget(app);

    strictEqual(target.affectedBy(join(app, 'collections', 'Posts.ts')), false);
    strictEqual(target.affectedBy(join(app, 'ohne.config.ts')), false);
  });

  it('owns the files its last regen generated', async () => {
    const app = writeApp('owns');
    await loadLayers(app);
    const target = createLayerCodegenTarget(app);
    const out = join(app, 'fields.txt');

    deepStrictEqual(await target.regen(), [out]);
    strictEqual(target.owns(out), true);
    strictEqual(target.owns(join(app, 'ohne.config.ts')), false);
  });

  it('reads an edited definition fresh on each regen', async () => {
    const app = writeApp('fresh');
    const posts = join(app, 'collections', 'Posts.ts');
    writeFileSync(posts, "export default { fields: { title: { type: 'text' } } };\n");
    await loadLayers(app);
    const target = createLayerCodegenTarget(app);

    await target.regen();
    strictEqual(readFileSync(join(app, 'fields.txt'), 'utf8'), 'true title');

    writeFileSync(
      posts,
      "export default { fields: { title: { type: 'text' }, body: { type: 'text' } } };\n",
    );
    utimesSync(posts, new Date(), new Date(Date.now() + 1_000));
    await target.regen();
    strictEqual(readFileSync(join(app, 'fields.txt'), 'utf8'), 'true title,body');
  });
});
