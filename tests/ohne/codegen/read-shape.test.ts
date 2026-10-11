import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import type { ShapeOwner } from '../../../src/ohne/codegen/read-shape.ts';
import type { FieldInstance } from '../../../src/ohne/fields/field.ts';

import {
  collectFieldTypes,
  emittableFieldTypes,
  readShapeType,
} from '../../../src/ohne/codegen/read-shape.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { createTypeImports } from '../../../src/utils/codegen/index.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');

const owner: ShapeOwner = { subject: 'Collection `Posts`', file: '/app/collections/Posts.ts' };

const fields: Record<string, FieldInstance> = {
  title: field('text', { translatable: true }),
  secret: field('text', { readable: false, nullable: true }),
  author: field('record', { collection: 'Authors' }),
  tags: field('records', { collection: 'Tags' }),
  steps: field('repeater', {
    fields: {
      by: field('record', { collection: 'Authors' }),
      hidden: field('text', { readable: false, nullable: true }),
    },
  }),
  content: field('blocks', { allow: ['Quote', 'Hero'] }),
};

const context = () => ({
  types: emittableFieldTypes([], []),
  blocks: ['Hero', 'Quote'],
  imports: createTypeImports('/app/.ohne/shared'),
  resolveText: () => undefined,
});

const typeOf = (members: { name: string; type: string }[], name: string) =>
  members.find((member) => member.name === name)?.type;

describe('readShapeType', () => {
  it('emits the database read types by default', () => {
    const members = readShapeType(owner, fields, context());
    deepStrictEqual(
      members.map((member) => member.name),
      ['title', 'secret', 'author', 'tags', 'steps', 'content'],
    );
    strictEqual(typeOf(members, 'title'), 'string | null');
    strictEqual(typeOf(members, 'author'), 'string | null');
    strictEqual(typeOf(members, 'tags'), 'string[]');
    ok(typeOf(members, 'content')?.includes("fields: GeneratedBlocks['Hero'];"));
    ok(!typeOf(members, 'steps')?.includes('hidden'));
  });

  it('drops a hidden top-level field from a nested shape', () => {
    const members = readShapeType(owner, fields, { ...context(), nested: true });
    strictEqual(typeOf(members, 'secret'), undefined);
  });

  it('drops a hidden top-level field when `dropHidden` is `always`', () => {
    const members = readShapeType(owner, fields, { ...context(), dropHidden: 'always' });
    strictEqual(typeOf(members, 'secret'), undefined);
    ok(typeOf(members, 'title'));
  });

  it('hands each relation to `relation` with its path and hint', () => {
    const seen: string[] = [];
    const members = readShapeType(owner, fields, {
      ...context(),
      relation: ({ path, hint }) => {
        seen.push(`${path}:${hint.kind}`);
        return hint.kind === 'junction'
          ? `Related['${hint.collection}'][]`
          : `Related['${hint.collection}'] | null`;
      },
    });
    deepStrictEqual(seen, ['author:foreignKey', 'tags:junction', 'steps[].by:foreignKey']);
    strictEqual(typeOf(members, 'tags'), "Related['Tags'][]");
    ok(typeOf(members, 'steps')?.includes("by: Related['Authors'] | null;"));
  });

  it('hands each blocks field to `blocksType` with its sorted names', () => {
    const members = readShapeType(owner, fields, {
      ...context(),
      blocksType: ({ allowed }) => `Block<${allowed.map((name) => `'${name}'`).join(' | ')}>[]`,
    });
    strictEqual(typeOf(members, 'content'), "Block<'Hero' | 'Quote'>[]");
  });

  it('emits each column through `scalar` and documents a degraded one', () => {
    const paths: string[] = [];
    const members = readShapeType(
      owner,
      { title: fields['title']! },
      {
        ...context(),
        scalar: ({ path, type }) => {
          paths.push(`${path}:${type}`);
          return { base: 'unknown', nullable: false, reason: 'It cannot.' };
        },
      },
    );
    deepStrictEqual(paths, ['title:text']);
    strictEqual(members[0]?.type, 'unknown | null');
    ok(members[0]?.doc.includes('`unknown` here: field type `text` declares no `emitJSONType`.'));
  });

  it('keeps only the type, nullability and translatability in `site` docs', () => {
    const [title] = readShapeType(
      owner,
      { title: fields['title']! },
      { ...context(), docs: 'site' },
    );
    const bullets = title?.doc.split('\n').filter((line) => line.startsWith(' * - '));
    deepStrictEqual(bullets, [' * - Type: `text`', ' * - Not nullable', ' * - Translatable']);
  });
});

describe('collectFieldTypes', () => {
  let app: string;

  before(() => {
    app = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-read-shape-')));
    mkdirSync(join(app, 'fields'), { recursive: true });
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
    writeFileSync(
      join(app, 'ohne.config.ts'),
      "export default { disable: { fields: ['time'] } };\n",
    );
    writeFileSync(
      join(app, 'fields', 'geo.ts'),
      "import { defineField } from 'ohnejs';\nexport default defineField({ columnType: 'json' });\n",
    );
  });

  after(() => {
    rmSync(app, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('carries each type with its directory, a layer type with its file too', async () => {
    await loadLayers(app);
    const types = await collectFieldTypes();
    deepStrictEqual(
      { dir: types.get('geo')?.dir, file: types.get('geo')?.file },
      { dir: join(app, 'fields'), file: join(app, 'fields', 'geo.ts') },
    );
    ok(types.has('text'));
    strictEqual(types.get('text')?.file, undefined);
    strictEqual(types.has('time'), false);
  });
});
