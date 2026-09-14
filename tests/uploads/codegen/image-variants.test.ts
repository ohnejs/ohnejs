import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { imageVariantsCodegen } from '../../../src/uploads/codegen/image-variants.ts';

const PATH = '/image-variants-codegen-test';

describe('imageVariantsCodegen', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('lands in the node bucket as image-variants.ts', () => {
    strictEqual(imageVariantsCodegen.bucket, 'node');
    strictEqual(imageVariantsCodegen.file, 'image-variants.ts');
  });

  it('augments KnownImageVariants with every configured name, sorted', async () => {
    useLayers().add({
      path: PATH,
      input: {
        uploads: { images: { variants: { wide: { width: 1600 }, hero: { width: 1200 } } } },
      },
    });
    strictEqual(
      await imageVariantsCodegen.code(),
      [
        "import type {} from 'ohnejs/uploads';",
        '',
        "declare module 'ohnejs/uploads' {",
        '  interface KnownImageVariants {',
        '    hero: true;',
        '    thumbnail: true;',
        '    wide: true;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });
});
