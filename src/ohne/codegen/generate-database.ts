import { fileURLToPath } from 'node:url';

import type { CollectedCollection } from '../collections/collect-collections.ts';
import type { ScannedMigration } from '../database/migrations/scan-layer-migrations.ts';
import type { CollectedFieldType } from '../fields/collect-fields.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type { ChildHint } from '../fields/storage-hint.ts';

import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
  createTypeImports,
  importSpecifier,
  indent,
  literalString,
  propertyKey,
  type TypeImports,
} from '../../utils/codegen/index.ts';
import { dirname, isNull, isString, isUndefined, joinPath } from '../../utils/index.ts';
import { collectCollections } from '../collections/collect-collections.ts';
import { collectMigrations } from '../database/migrations/collect-migrations.ts';
import { ohneError } from '../error/ohne-error.ts';
import { collectFields } from '../fields/collect-fields.ts';
import { resolveFieldOptions } from '../fields/field.ts';
import { useFields } from '../fields/use-fields.ts';
import { fieldValueType } from '../fields/value-type.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';

/**
 * Options for `generateDatabase`.
 */
export interface GenerateDatabaseOptions {
  /**
   * Re-import each collection and field-type definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * One emittable field type: its definition plus the directory `importType` paths resolve against.
 */
interface EmittableFieldType {
  fieldType: FieldType;
  dir: string;
}

/**
 * The directory of the built-in field types, used when a built-in's `importType` resolves a path.
 */
const BUILTIN_DIR = fileURLToPath(new URL('../fields/builtin/', import.meta.url));

/**
 * Generates the database types and registrations from every layer's schema directories.
 *
 * `shared/database.ts` carries the pure types: `GeneratedCollections` and `GeneratedDatabases`.
 * `node/database.ts` imports every collection, field-type, and migration definition and registers it.
 * It also augments `KnownCollections`, `KnownFields`, and `KnownDatabases` via `declare module`.
 * Migration registration order is the execution order: furthest layer first, name order within a layer.
 * Both files are written even when empty, so a stale one never imports deleted files.
 *
 * Definitions are read from each layer's `Config.dirs` directories and combined closer-wins.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * Names in `Config.disable.collections` and `Config.disable.fields` are dropped before emission.
 * A disabled built-in field type is deleted from the registry at registration time.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the app's own `dirs.codegen` (default `.ohne`), resolved against that root.
 *
 * Each file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateDatabase(
  from: string = process.cwd(),
  options: GenerateDatabaseOptions = {},
): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];

  const { fresh = false } = options;
  const disable = useConfig().disable;
  const helpers = Object.keys(useConfig().database?.helpers ?? {}).sort();
  const [collections, fields, migrations] = await Promise.all([
    collectCollections(stackedLayers(), { disable: disable.collections, fresh }),
    collectFields(stackedLayers(), { disable: disable.fields, fresh }),
    collectMigrations(stackedLayers()),
  ]);

  return Promise.all([
    writeShared(joinPath(dir, 'shared'), collections, fields, disable.fields, helpers),
    writeNode(joinPath(dir, 'node'), collections, fields, migrations, disable.fields),
  ]);
}

/**
 * Writes `shared/database.ts`, the pure type bucket.
 * It carries `GeneratedCollections`, `GeneratedRelations`, and `GeneratedDatabases`.
 * The collection traversal runs before emission, so `importType` records its `import type` lines first.
 */
async function writeShared(
  dir: string,
  collections: readonly CollectedCollection[],
  fields: readonly CollectedFieldType[],
  disabledFields: readonly string[],
  helpers: readonly string[],
): Promise<string> {
  const imports = createTypeImports(dir);
  const types = emittableFieldTypes(fields, disabledFields);
  const members = collections.map((collection) => ({
    name: collection.name,
    fields: Object.entries(collection.collection.fields).map(([name, instance]) => ({
      name,
      type: valueTypeOf(collection, name, instance, types, imports),
    })),
    relations: owningRelationsOf(collection, types),
  }));

  const code = createCodeBuilder();
  const statements = imports.statements();
  if (statements.length > 0) {
    code.lines(statements);
    code.line();
  }
  if (members.length === 0) {
    code.line('export interface GeneratedCollections {}');
  } else {
    code.line('export interface GeneratedCollections {');
    code.indent(() => {
      for (const member of members) {
        if (member.fields.length === 0) {
          code.line(`${propertyKey(member.name)}: {};`);
          continue;
        }
        code.line(`${propertyKey(member.name)}: {`);
        code.indent(() => {
          for (const field of member.fields) {
            code.line(`${propertyKey(field.name)}: ${field.type};`);
          }
        });
        code.line('};');
      }
    });
    code.line('}');
  }
  code.line();
  if (members.length === 0) {
    code.line('export interface GeneratedRelations {}');
  } else {
    code.line('export interface GeneratedRelations {');
    code.indent(() => {
      for (const member of members) {
        if (member.relations.length === 0) {
          code.line(`${propertyKey(member.name)}: {};`);
          continue;
        }
        code.line(`${propertyKey(member.name)}: {`);
        code.indent(() => {
          for (const relation of member.relations) {
            code.line(`${propertyKey(relation.name)}: ${literalString(relation.target)};`);
          }
        });
        code.line('};');
      }
    });
    code.line('}');
  }
  code.line();
  if (helpers.length === 0) {
    code.line('export interface GeneratedDatabases {}');
  } else {
    code.line('export interface GeneratedDatabases {');
    code.indent(() => {
      for (const helper of helpers) code.line(`${propertyKey(helper)}: true;`);
    });
    code.line('}');
  }
  return write(dir, code);
}

/**
 * Writes `node/database.ts`: imports every definition, augments `ohne`, and registers each one.
 */
async function writeNode(
  dir: string,
  collections: readonly CollectedCollection[],
  fields: readonly CollectedFieldType[],
  migrations: readonly ScannedMigration[],
  disabledFields: readonly string[],
): Promise<string> {
  const builtins = new Set(useFields().keys());
  const deletions = disabledFields.filter((name) => builtins.has(name));
  const augmented = fields.filter((fieldType) => !builtins.has(fieldType.name));

  const code = createCodeBuilder();
  const uses = [
    collections.length > 0 ? 'useCollections' : null,
    fields.length > 0 || deletions.length > 0 ? 'useFields' : null,
    migrations.length > 0 ? 'useMigrations' : null,
  ].filter(isString);
  if (uses.length > 0) {
    code.line(`import { ${uses.join(', ')} } from 'ohne';`);
    code.line();
  }
  collections.forEach((collection, i) => {
    code.line(`import c${i} from ${literalString(importSpecifier(dir, collection.file))};`);
  });
  fields.forEach((fieldType, i) => {
    code.line(`import f${i} from ${literalString(importSpecifier(dir, fieldType.file))};`);
  });
  migrations.forEach((migration, i) => {
    code.line(`import m${i} from ${literalString(importSpecifier(dir, migration.file))};`);
  });
  if (collections.length + fields.length + migrations.length > 0) code.line();

  code.line(
    "import type { GeneratedCollections, GeneratedDatabases, GeneratedRelations } from '../shared/database.ts';",
  );
  code.line();
  code.line("declare module 'ohne' {");
  code.indent(() => {
    code.line('interface KnownCollections extends GeneratedCollections {}');
    code.line('interface KnownRelations extends GeneratedRelations {}');
    code.line('interface KnownDatabases extends GeneratedDatabases {}');
    if (augmented.length === 0) {
      code.line('interface KnownFields {}');
    } else {
      code.line('interface KnownFields {');
      code.indent(() => {
        for (const fieldType of augmented) {
          const specifier = literalString(importSpecifier(dir, fieldType.file));
          code.line(`${propertyKey(fieldType.name)}: typeof import(${specifier}).default;`);
        }
      });
      code.line('}');
    }
  });
  code.line('}');

  if (collections.length > 0) {
    code.line();
    code.line('const collections = useCollections();');
    collections.forEach((collection, i) => {
      const name = literalString(collection.name);
      code.line(`collections.register(${name}, { name: ${name}, collection: c${i} });`);
    });
  }
  if (fields.length > 0 || deletions.length > 0) {
    code.line();
    code.line('const fields = useFields();');
    for (const name of deletions) code.line(`fields.delete(${literalString(name)});`);
    fields.forEach((fieldType, i) => {
      const name = literalString(fieldType.name);
      code.line(`fields.register(${name}, { name: ${name}, fieldType: f${i} });`);
    });
  }
  if (migrations.length > 0) {
    code.line();
    code.line('const migrations = useMigrations();');
    migrations.forEach((migration, i) => {
      code.line();
      code.line(`migrations.register(${literalString(migration.name)}, {`);
      code.indent(() => {
        code.line(`name: ${literalString(migration.name)},`);
        code.line(`migration: m${i},`);
        code.line(`file: ${literalString(migration.file)},`);
      });
      code.line('});');
    });
  }
  return write(dir, code);
}

async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('database.ts', code.toString());
  return gen.path('database.ts');
}

/**
 * Maps every emittable field-type name to its definition: built-ins first, scanned types on top.
 * Disabled names drop the built-in they would otherwise resolve to.
 */
function emittableFieldTypes(
  fields: readonly CollectedFieldType[],
  disabledFields: readonly string[],
): Map<string, EmittableFieldType> {
  const map = new Map<string, EmittableFieldType>();
  for (const [name, meta] of Object.entries(useFields().all())) {
    map.set(name, { fieldType: meta.fieldType, dir: BUILTIN_DIR });
  }
  for (const name of disabledFields) map.delete(name);
  for (const collected of fields) {
    map.set(collected.name, { fieldType: collected.fieldType, dir: dirname(collected.file) });
  }
  return map;
}

/**
 * Emits one field's TypeScript value type, resolving its type name against the emittable set.
 * A child hint assembles its shape from its subfields here, where the emittable set is at hand.
 */
function valueTypeOf(
  collection: CollectedCollection,
  name: string,
  instance: FieldInstance,
  types: Map<string, EmittableFieldType>,
  imports: TypeImports,
): string {
  const registered = types.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: [
        `Collection \`${collection.name}\` references field type \`${instance.type}\`, which is not registered.`,
      ],
      path: collection.file,
    });
  }
  const { fieldType } = registered;
  if (fieldType.columnType === false && !isUndefined(fieldType.schema)) {
    const options = resolveFieldOptions(fieldType, { ...instance.options });
    const hint = fieldType.schema({ name, options });
    if (hint.kind === 'child') return childValueType(collection, hint, types, imports);
  }
  return fieldValueType({
    fieldType,
    name,
    options: { ...instance.options },
    fieldDir: registered.dir,
    imports,
  });
}

/**
 * Assembles a composite's inline record shape from its subfields, recursively.
 * Each line carries its relative indentation; the emission site indents the whole block.
 * `one` cardinality reads back one row or none, so the shape is nullable; `many` is an array.
 */
function childValueType(
  collection: CollectedCollection,
  hint: ChildHint,
  types: Map<string, EmittableFieldType>,
  imports: TypeImports,
): string {
  const lines = ['{'];
  for (const [name, instance] of Object.entries(hint.subfields)) {
    const type = valueTypeOf(collection, name, instance, types, imports);
    lines.push(indent(`${propertyKey(name)}: ${type};`));
  }
  lines.push(hint.cardinality === 'one' ? '} | null' : '}[]');
  return lines.join('\n');
}

/**
 * Collects one collection's owning relation fields: junction hints without `inverse`.
 * These become the collection's `GeneratedRelations` member, each mapped to its target's name.
 * Top-level collection fields only, by contract - the map never descends into subfields.
 */
function owningRelationsOf(
  collection: CollectedCollection,
  types: Map<string, EmittableFieldType>,
): { name: string; target: string }[] {
  const relations: { name: string; target: string }[] = [];
  for (const [name, instance] of Object.entries(collection.collection.fields)) {
    const fieldType = types.get(instance.type)?.fieldType;
    if (isUndefined(fieldType?.schema)) continue;
    const options = resolveFieldOptions(fieldType, { ...instance.options });
    const hint = fieldType.schema({ name, options });
    if (hint.kind !== 'junction' || !isUndefined(hint.inverse)) continue;
    relations.push({ name, target: hint.collection });
  }
  return relations;
}
