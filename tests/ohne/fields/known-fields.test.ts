import { deepStrictEqual } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { KnownFields, LayerFields, link, richText } from '../../../src/ohne/index.ts';

import { scanLayerFields } from '../../../src/ohne/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const MIRRORED = [
  'datePattern',
  'directoryName',
  'file',
  'fileName',
  'files',
  'image',
  'images',
  'language',
  'locale',
  'password',
  'roles',
  'timezone',
] as const;

describe('KnownFields', () => {
  it('maps `richText` and `link` to their definitions', () => {
    const rich: Equal<KnownFields['richText'], typeof richText> = true;
    const plain: Equal<KnownFields['link'], typeof link> = true;
    deepStrictEqual([rich, plain], [true, true]);
  });
});

describe('LayerFields', () => {
  it("mirrors every field type the shipped layers' fields directories hold", async () => {
    const exact: Equal<(typeof MIRRORED)[number], keyof LayerFields> = true;
    const src = join(import.meta.dirname, '../../../src');
    const scanned = await Promise.all(
      ['base', 'uploads'].map((name) => scanLayerFields({ name, dir: join(src, name) }, 'fields')),
    );

    deepStrictEqual(
      scanned
        .flat()
        .map((type) => type.name)
        .sort(),
      [...MIRRORED],
    );
    deepStrictEqual(exact, true);
  });
});
