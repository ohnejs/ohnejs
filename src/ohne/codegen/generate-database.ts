import { fileURLToPath } from 'node:url';

import type { CollectedBlock } from '../blocks/collect-blocks.ts';
import type { CollectedCollection } from '../collections/collect-collections.ts';
import type { ScannedMigration } from '../database/migrations/scan-layer-migrations.ts';
import type { CollectedFieldType } from '../fields/collect-fields.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type {
  BlocksHint,
  ChildHint,
  ForeignKeyHint,
  JunctionHint,
} from '../fields/storage-hint.ts';

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
import {
  dirname,
  hasKey,
  isArray,
  isNull,
  isObject,
  isString,
  isUndefined,
  joinPath,
} from '../../utils/index.ts';
import { collectBlocks } from '../blocks/collect-blocks.ts';
import { resolveAllowedBlocks } from '../blocks/resolve-allowed-blocks.ts';
import { collectCollections } from '../collections/collect-collections.ts';
import { resolveLocales } from '../collections/resolve-locales.ts';
import { collectMigrations } from '../database/migrations/collect-migrations.ts';
import { ohneError } from '../error/ohne-error.ts';
import { collectFields } from '../fields/collect-fields.ts';
import { resolveFieldOptions } from '../fields/field.ts';
import { resolveFieldStorage, type ResolvedFieldStorage } from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';
import { fieldBaseType } from '../fields/value-type.ts';
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
 * The definition a field under emission belongs to, as the error messages name it.
 */
interface EmissionOwner {
  subject: string;
  file: string;
}

/**
 * Everything one field's value type resolves against.
 */
interface EmissionContext {
  types: Map<string, EmittableFieldType>;
  blocks: readonly CollectedBlock[];
  imports: TypeImports;
}

/**
 * The directory of the built-in field types, used when a built-in's `importType` resolves a path.
 */
const BUILTIN_DIR = fileURLToPath(new URL('../fields/builtin/', import.meta.url));

/**
 * The `UUID` entry every collection and composite scope leads its query-field table with.
 */
const UUID_QUERY_ENTRY = '{ scalar: string; id: true }';

/**
 * The `_updatedAt` entry every collection carries in its query-field table.
 */
const UPDATED_AT_QUERY_ENTRY = '{ scalar: number }';

/**
 * Generates the database types and registrations from every layer's schema directories.
 *
 * `shared/database.ts` carries the pure types: `GeneratedCollections`, `GeneratedBlocks`, and friends.
 * `node/database.ts` imports every collection, block, field-type, and migration definition.
 * Importing it registers them all.
 * It also augments `KnownCollections`, `KnownBlocks`, `KnownFields`, and `KnownDatabases`.
 * Migration registration order is the execution order: furthest layer first, name order within a layer.
 * Both files are written even when empty, so a stale one never imports deleted files.
 *
 * Definitions are read from each layer's `Config.dirs` directories and combined closer-wins.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * Names in `Config.disable.collections`, `disable.fields`, and `disable.blocks` drop before emission.
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
  const locales = resolveLocales(useConfig().collections).locales;
  const [collections, fields, blocks, migrations] = await Promise.all([
    collectCollections(stackedLayers(), { disable: disable.collections, fresh }),
    collectFields(stackedLayers(), { disable: disable.fields, fresh }),
    collectBlocks(stackedLayers(), { disable: disable.blocks, fresh }),
    collectMigrations(stackedLayers()),
  ]);

  return Promise.all([
    writeShared(
      joinPath(dir, 'shared'),
      collections,
      fields,
      blocks,
      disable.fields,
      helpers,
      locales,
    ),
    writeNode(joinPath(dir, 'node'), collections, fields, blocks, migrations, disable.fields),
  ]);
}

/**
 * Writes `shared/database.ts`, the pure type bucket.
 * It carries `GeneratedCollections`, `GeneratedRelations`, `GeneratedBlocks`, and `GeneratedDatabases`.
 * `GeneratedLocales` closes the file with the configured locale set.
 * The traversals run before emission, so `importType` records its `import type` lines first.
 */
async function writeShared(
  dir: string,
  collections: readonly CollectedCollection[],
  fields: readonly CollectedFieldType[],
  blocks: readonly CollectedBlock[],
  disabledFields: readonly string[],
  helpers: readonly string[],
  locales: readonly string[],
): Promise<string> {
  const imports = createTypeImports(dir);
  const context: EmissionContext = {
    types: emittableFieldTypes(fields, disabledFields),
    blocks,
    imports,
  };
  const members = collections.map((collection) => ({
    name: collection.name,
    fields: [
      { name: 'UUID', type: 'string' },
      { name: '_updatedAt', type: 'number' },
      ...fieldShapesOf(
        { subject: `Collection \`${collection.name}\``, file: collection.file },
        collection.collection.fields,
        context,
      ),
    ],
    relations: owningRelationsOf(collection, context.types),
  }));
  const blockMembers = blocks.map((block) => ({
    name: block.name,
    fields: fieldShapesOf(
      { subject: `Block \`${block.name}\``, file: block.file },
      block.block.fields,
      context,
    ),
  }));
  const queryMembers = collections.map((collection) => ({
    name: collection.name,
    fields: [
      { name: 'UUID', type: UUID_QUERY_ENTRY },
      { name: '_updatedAt', type: UPDATED_AT_QUERY_ENTRY },
      ...queryFieldsOf(
        { subject: `Collection \`${collection.name}\``, file: collection.file },
        collection.collection.fields,
        context,
      ),
    ],
  }));
  const blockQueryMembers = blocks.map((block) => ({
    name: block.name,
    fields: [
      { name: 'UUID', type: UUID_QUERY_ENTRY },
      ...queryFieldsOf(
        { subject: `Block \`${block.name}\``, file: block.file },
        block.block.fields,
        context,
      ),
    ],
  }));
  const blockInsertMembers = blocks.map((block) => ({
    name: block.name,
    fields: insertShapesOf(
      { subject: `Block \`${block.name}\``, file: block.file },
      block.block.fields,
      context,
    ),
  }));
  const blockUpdateMembers = blocks.map((block) => ({
    name: block.name,
    fields: updateShapesOf(
      { subject: `Block \`${block.name}\``, file: block.file },
      block.block.fields,
      context,
    ),
  }));
  const insertMembers = collections.map((collection) => ({
    name: collection.name,
    fields: insertShapesOf(
      { subject: `Collection \`${collection.name}\``, file: collection.file },
      collection.collection.fields,
      context,
    ),
  }));
  const updateMembers = collections.map((collection) => ({
    name: collection.name,
    fields: updateShapesOf(
      { subject: `Collection \`${collection.name}\``, file: collection.file },
      collection.collection.fields,
      context,
    ),
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
      for (const member of members) emitFieldShapes(code, member.name, member.fields);
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
  if (queryMembers.length === 0) {
    code.line('export interface GeneratedQueryFields {}');
  } else {
    code.line('export interface GeneratedQueryFields {');
    code.indent(() => {
      for (const member of queryMembers) emitFieldShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (blockMembers.length === 0) {
    code.line('export interface GeneratedBlocks {}');
  } else {
    code.line('export interface GeneratedBlocks {');
    code.indent(() => {
      for (const member of blockMembers) emitFieldShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (blockQueryMembers.length === 0) {
    code.line('export interface GeneratedBlockQueryFields {}');
  } else {
    code.line('export interface GeneratedBlockQueryFields {');
    code.indent(() => {
      for (const member of blockQueryMembers) emitFieldShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (insertMembers.length === 0) {
    code.line('export interface GeneratedInserts {}');
  } else {
    code.line('export interface GeneratedInserts {');
    code.indent(() => {
      for (const member of insertMembers) emitInsertShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (blockInsertMembers.length === 0) {
    code.line('export interface GeneratedBlockInserts {}');
  } else {
    code.line('export interface GeneratedBlockInserts {');
    code.indent(() => {
      for (const member of blockInsertMembers) emitInsertShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (updateMembers.length === 0) {
    code.line('export interface GeneratedUpdates {}');
  } else {
    code.line('export interface GeneratedUpdates {');
    code.indent(() => {
      for (const member of updateMembers) emitUpdateShapes(code, member.name, member.fields);
    });
    code.line('}');
  }
  code.line();
  if (blockUpdateMembers.length === 0) {
    code.line('export interface GeneratedBlockUpdates {}');
  } else {
    code.line('export interface GeneratedBlockUpdates {');
    code.indent(() => {
      for (const member of blockUpdateMembers) emitInsertShapes(code, member.name, member.fields);
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
  code.line();
  code.line('export interface GeneratedLocales {');
  code.indent(() => {
    for (const locale of locales) code.line(`${propertyKey(locale)}: true;`);
  });
  code.line('}');
  return write(dir, code);
}

/**
 * Resolves one definition's field map into named value types, ready for interface emission.
 */
function fieldShapesOf(
  owner: EmissionOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
): { name: string; type: string }[] {
  return Object.entries(fields).map(([name, instance]) => ({
    name,
    type: valueTypeOf(owner, name, instance, context),
  }));
}

/**
 * Emits one interface member: the name, then its field shape, `{}` when the definition holds none.
 */
function emitFieldShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    for (const field of fields) {
      code.line(`${propertyKey(field.name)}: ${field.type};`);
    }
  });
  code.line('};');
}

/**
 * Emits one input member: each field's name, an optional marker, and its input type.
 * A nullable-or-defaulted field is optional; a required field is not.
 * The block update table rides it too: a provided item is a full item, so create optionality holds.
 */
function emitInsertShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string; optional: boolean }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    for (const field of fields) {
      code.line(`${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type};`);
    }
  });
  code.line('};');
}

/**
 * Emits one update-input member: each field's name, always optional, and its input type.
 */
function emitUpdateShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    for (const field of fields) code.line(`${propertyKey(field.name)}?: ${field.type};`);
  });
  code.line('};');
}

/**
 * Writes `node/database.ts`: imports every definition, augments `ohne`, and registers each one.
 */
async function writeNode(
  dir: string,
  collections: readonly CollectedCollection[],
  fields: readonly CollectedFieldType[],
  blocks: readonly CollectedBlock[],
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
    blocks.length > 0 ? 'useBlocks' : null,
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
  blocks.forEach((block, i) => {
    code.line(`import b${i} from ${literalString(importSpecifier(dir, block.file))};`);
  });
  migrations.forEach((migration, i) => {
    code.line(`import m${i} from ${literalString(importSpecifier(dir, migration.file))};`);
  });
  if (collections.length + fields.length + blocks.length + migrations.length > 0) code.line();

  code.line(
    "import type { GeneratedBlockQueryFields, GeneratedBlocks, GeneratedCollections, GeneratedDatabases, GeneratedInserts, GeneratedLocales, GeneratedQueryFields, GeneratedRelations, GeneratedUpdates } from '../shared/database.ts';",
  );
  code.line();
  code.line("declare module 'ohne' {");
  code.indent(() => {
    code.line('interface KnownCollections extends GeneratedCollections {}');
    code.line('interface KnownRelations extends GeneratedRelations {}');
    code.line('interface KnownQueryFields extends GeneratedQueryFields {}');
    code.line('interface KnownBlockQueryFields extends GeneratedBlockQueryFields {}');
    code.line('interface KnownInserts extends GeneratedInserts {}');
    code.line('interface KnownUpdates extends GeneratedUpdates {}');
    code.line('interface KnownBlocks extends GeneratedBlocks {}');
    code.line('interface KnownDatabases extends GeneratedDatabases {}');
    code.line('interface KnownLocales extends GeneratedLocales {}');
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
  if (blocks.length > 0) {
    code.line();
    code.line('const blocks = useBlocks();');
    blocks.forEach((block, i) => {
      const name = literalString(block.name);
      code.line(`blocks.register(${name}, { name: ${name}, block: b${i} });`);
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
 * A blocks hint assembles its union from the collected blocks on the same terms.
 * A translatable column-bearing field reads `null` where the queried locale holds no translation.
 * Its read shape therefore folds `| null` in whatever its own nullability says.
 */
function valueTypeOf(
  owner: EmissionOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): string {
  const registered = context.types.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: [
        `${owner.subject} references field type \`${instance.type}\`, which is not registered.`,
      ],
      path: owner.file,
    });
  }
  const { fieldType } = registered;
  if (fieldType.columnType === false && !isUndefined(fieldType.schema)) {
    const options = resolveFieldOptions(fieldType, { ...instance.options });
    const hint = fieldType.schema({ name, options });
    if (hint.kind === 'child') return childValueType(owner, hint, context);
    if (hint.kind === 'blocks') return blocksValueType(owner, name, hint, context);
  }
  const { base, nullable } = fieldBaseType({
    fieldType,
    name,
    options: { ...instance.options },
    fieldDir: registered.dir,
    imports: context.imports,
  });
  const perLocale = fieldType.columnType !== false && instance.options.translatable === true;
  return nullable || perLocale ? `${base} | null` : base;
}

/**
 * Assembles a composite's inline record shape from its subfields, recursively.
 * Each line carries its relative indentation; the emission site indents the whole block.
 * The item `UUID` leads the shape, matching the read: every child row exposes its stable identity.
 * `one` cardinality reads back one row or none, so the shape is nullable; `many` is an array.
 */
function childValueType(owner: EmissionOwner, hint: ChildHint, context: EmissionContext): string {
  const lines = ['{', indent('UUID: string;')];
  for (const [name, instance] of Object.entries(hint.subfields)) {
    const type = valueTypeOf(owner, name, instance, context);
    lines.push(indent(`${propertyKey(name)}: ${type};`));
  }
  lines.push(hint.cardinality === 'one' ? '} | null' : '}[]');
  return lines.join('\n');
}

/**
 * Resolves a blocks field's allowed type names through the shared resolver, sorted and validated.
 * An empty set or an unregistered name throws, naming the owning definition.
 */
function allowedBlocksOf(
  owner: EmissionOwner,
  name: string,
  hint: BlocksHint,
  context: EmissionContext,
): string[] {
  const result = resolveAllowedBlocks(
    hint.allow,
    context.blocks.map((block) => block.name),
  );
  if (result.ok) return result.allowed;
  if (result.reason === 'empty') {
    throw ohneError({
      title: `Field \`${name}\` has no block types to hold`,
      body: [
        `${owner.subject} declares a blocks field, but no block is registered.`,
        'Define one under `dirs.blocks`, or drop the field.',
      ],
      path: owner.file,
    });
  }
  throw ohneError({
    title: `Unknown block \`${result.block}\``,
    body: [`${owner.subject} allows block \`${result.block}\`, which is not registered.`],
    path: owner.file,
  });
}

/**
 * Wraps blocks item shapes into their list type: a lone item stays bare, a union gains parens.
 */
function blocksListType(items: string[]): string {
  if (items.length === 1) return `${items[0] as string}[]`;
  return ['(', ...items.map((item) => indent(`| ${item}`)), ')[]'].join('\n');
}

/**
 * Assembles a blocks field's value type: an array over the union of its allowed block shapes.
 * Each item names its block and carries the instance `UUID`.
 * That block's `GeneratedBlocks` member rides as `fields`.
 * The shared resolver sorts and validates, so the desired schema and this shape never disagree.
 */
function blocksValueType(
  owner: EmissionOwner,
  name: string,
  hint: BlocksHint,
  context: EmissionContext,
): string {
  const items = allowedBlocksOf(owner, name, hint, context).map(
    (block) =>
      `{ block: ${literalString(block)}; UUID: string; fields: GeneratedBlocks[${literalString(block)}] }`,
  );
  return blocksListType(items);
}

/**
 * Resolves one collection or composite field map into named `QueryFieldMeta` type literals.
 */
function queryFieldsOf(
  owner: EmissionOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
): { name: string; type: string }[] {
  return Object.entries(fields).map(([name, instance]) => ({
    name,
    type: queryFieldType(owner, name, instance, context),
  }));
}

/**
 * Emits one field's `QueryFieldMeta` type literal: the markers it carries decide its operators.
 * A column carries `scalar` (and `nullable`); a `record` adds its target.
 * A `records` or composite field carries only its relation marker.
 * A blocks field carries its allowed type names as a `blocks` union.
 * The kind is read through the same `resolveFieldStorage` walk the runtime metadata uses.
 */
function queryFieldType(
  owner: EmissionOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): string {
  const registered = context.types.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: [
        `${owner.subject} references field type \`${instance.type}\`, which is not registered.`,
      ],
      path: owner.file,
    });
  }
  const resolved = resolveFieldStorage(name, instance, registered.fieldType);
  const { hint, kind } = resolved;
  const translatable = resolved.options.translatable === true;
  const when = hasKey(instance.options, 'when') ? conditionLiteral(instance.options.when) : null;

  if (kind === 'blocks') {
    const allowed = allowedBlocksOf(owner, name, hint as BlocksHint, context);
    return metaLiteral(
      [
        `blocks: ${allowed.map((block) => literalString(block)).join(' | ')}`,
        ...(translatable ? ['localeScoped: true'] : []),
      ],
      when,
    );
  }
  if (kind === 'junction') {
    return metaLiteral(
      [
        `records: ${literalString((hint as JunctionHint).collection)}`,
        ...(translatable ? ['localeScoped: true'] : []),
      ],
      when,
    );
  }
  if (kind === 'childOne' || kind === 'childMany') {
    const cardinality = kind === 'childOne' ? 'one' : 'many';
    const subfields = [
      { name: 'UUID', type: UUID_QUERY_ENTRY },
      ...queryFieldsOf(owner, (hint as ChildHint).subfields, context),
    ];
    const body = subfields.map((field) => `${propertyKey(field.name)}: ${field.type}`).join('; ');
    return metaLiteral(
      [
        `child: ${literalString(cardinality)}`,
        `fields: { ${body} }`,
        ...(translatable ? ['localeScoped: true'] : []),
      ],
      when,
    );
  }

  const { base, nullable } = fieldBaseType({
    fieldType: registered.fieldType,
    name,
    options: { ...instance.options },
    fieldDir: registered.dir,
    imports: context.imports,
  });
  const parts = [`scalar: ${base}`];
  if (kind === 'foreignKey') {
    parts.push(`record: ${literalString((hint as ForeignKeyHint).collection)}`);
  }
  if (nullable) parts.push('nullable: true');
  if (translatable) parts.push('companion: true');
  return metaLiteral(parts, when);
}

/**
 * Joins one field's metadata parts into its literal, appending the `when` passenger when the field has one.
 */
function metaLiteral(parts: string[], when: string | null): string {
  return `{ ${(isNull(when) ? parts : [...parts, `when: ${when}`]).join('; ')} }`;
}

/**
 * Renders a `when` condition object as a TypeScript type literal, the passenger the dashboard reads.
 * String values quote through `literalString`; keys quote through `propertyKey`, so an anchored path holds.
 */
function conditionLiteral(value: unknown): string {
  if (isString(value)) return literalString(value);
  if (isArray(value)) return `[${value.map(conditionLiteral).join(', ')}]`;
  if (isObject(value)) {
    const body = Object.entries(value)
      .map(([key, nested]) => `${propertyKey(key)}: ${conditionLiteral(nested)}`)
      .join('; ');
    return `{ ${body} }`;
  }
  return String(value);
}

/**
 * Resolves one field map into named create-input shapes.
 */
function insertShapesOf(
  owner: EmissionOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
): { name: string; type: string; optional: boolean }[] {
  return Object.entries(fields).map(([name, instance]) => ({
    name,
    ...insertFieldType(owner, name, instance, context),
  }));
}

/**
 * Resolves one field's storage for input emission, throwing when its type is not registered.
 */
function resolveInputStorage(
  owner: EmissionOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): { registered: EmittableFieldType } & Pick<ResolvedFieldStorage, 'hint' | 'kind' | 'options'> {
  const registered = context.types.get(instance.type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${instance.type}\``,
      body: [
        `${owner.subject} references field type \`${instance.type}\`, which is not registered.`,
      ],
      path: owner.file,
    });
  }
  const { hint, kind, options } = resolveFieldStorage(name, instance, registered.fieldType);
  return { registered, hint, kind, options };
}

/**
 * The input value type of one column or `record` field, `| null` folded in when the field is nullable.
 * Shared by the create and update shapes, which differ only in optionality and item identity.
 */
function inputScalarType(
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
  resolved: ReturnType<typeof resolveInputStorage>,
): { type: string; nullable: boolean } {
  const { registered, kind, options } = resolved;
  if (kind === 'foreignKey') {
    const nullable = options.nullable === true;
    return { type: nullable ? 'string | null' : 'string', nullable };
  }
  const { base, nullable } = fieldBaseType({
    fieldType: registered.fieldType,
    name,
    options: { ...instance.options },
    fieldDir: registered.dir,
    imports: context.imports,
  });
  return { type: nullable ? `${base} | null` : base, nullable };
}

/**
 * Emits one field's create-input type and whether it is optional.
 *
 * A column or `record` takes its value type, optional when nullable or defaulted.
 * A `records` list is optional and defaults to `[]`; an `object` is optional and accepts `null`.
 * A `repeater` is an optional list of item shapes; a create item carries no `UUID`.
 * A blocks field is an optional list of `{ block; fields }` envelopes, defaulting to `[]`.
 * `fields` references the type's `GeneratedBlockInserts` member, so self-nesting terminates.
 */
function insertFieldType(
  owner: EmissionOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): { type: string; optional: boolean } {
  const resolved = resolveInputStorage(owner, name, instance, context);
  const { hint, kind, options } = resolved;
  if (kind === 'blocks') {
    const items = allowedBlocksOf(owner, name, hint as BlocksHint, context).map(
      (block) =>
        `{ block: ${literalString(block)}; fields: GeneratedBlockInserts[${literalString(block)}] }`,
    );
    return { type: blocksListType(items), optional: true };
  }
  if (kind === 'junction') return { type: 'string[]', optional: true };
  if (kind === 'childOne') {
    return {
      type: `${insertObjectType(owner, hint as ChildHint, context)} | null`,
      optional: true,
    };
  }
  if (kind === 'childMany') {
    return { type: `${insertObjectType(owner, hint as ChildHint, context)}[]`, optional: true };
  }

  const defaulted =
    hasKey(options, 'default') || !isUndefined(resolved.registered.fieldType.defaultValue);
  const { type, nullable } = inputScalarType(name, instance, context, resolved);
  return { type, optional: nullable || defaulted };
}

/**
 * Emits a composite item's create-input object type from its subfields.
 */
function insertObjectType(owner: EmissionOwner, hint: ChildHint, context: EmissionContext): string {
  const shapes = insertShapesOf(owner, hint.subfields, context);
  const body = shapes
    .map((field) => `${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type}`)
    .join('; ');
  return `{ ${body} }`;
}

/**
 * Resolves one field map into named update-input shapes.
 */
function updateShapesOf(
  owner: EmissionOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
): { name: string; type: string; optional: boolean }[] {
  return Object.entries(fields).map(([name, instance]) => ({
    name,
    ...updateFieldType(owner, name, instance, context),
  }));
}

/**
 * Emits one field's update-input type and whether it is optional within a composite item.
 *
 * The value type matches the create shape, `| null` folded when nullable.
 * A provided composite item is a full item, so a subfield is optional exactly when create makes it so.
 * The top level relaxes every field to optional separately, for a partial update.
 * A repeater item carries an optional `UUID`, so a matched item keeps its identity.
 * A blocks item does the same: its `{ block; UUID?; fields }` envelope names the instance.
 * `fields` references the type's `GeneratedBlockUpdates` member, so self-nesting terminates.
 */
function updateFieldType(
  owner: EmissionOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): { type: string; optional: boolean } {
  const resolved = resolveInputStorage(owner, name, instance, context);
  const { hint, kind, options } = resolved;
  if (kind === 'blocks') {
    const items = allowedBlocksOf(owner, name, hint as BlocksHint, context).map(
      (block) =>
        `{ block: ${literalString(block)}; UUID?: string; fields: GeneratedBlockUpdates[${literalString(block)}] }`,
    );
    return { type: blocksListType(items), optional: true };
  }
  if (kind === 'junction') return { type: 'string[]', optional: true };
  if (kind === 'childOne') {
    return {
      type: `${updateObjectType(owner, hint as ChildHint, context, false)} | null`,
      optional: true,
    };
  }
  if (kind === 'childMany') {
    return {
      type: `${updateObjectType(owner, hint as ChildHint, context, true)}[]`,
      optional: true,
    };
  }
  const defaulted =
    hasKey(options, 'default') || !isUndefined(resolved.registered.fieldType.defaultValue);
  const { type, nullable } = inputScalarType(name, instance, context, resolved);
  return { type, optional: nullable || defaulted };
}

/**
 * Emits a composite item's update-input object type, each subfield at its create-time optionality.
 * A repeater item carries `UUID?: string`, so a matched item keeps its identity across the update.
 */
function updateObjectType(
  owner: EmissionOwner,
  hint: ChildHint,
  context: EmissionContext,
  identified: boolean,
): string {
  const fields = updateShapesOf(owner, hint.subfields, context).map(
    (field) => `${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type}`,
  );
  const body = (identified ? [`${propertyKey('UUID')}?: string`, ...fields] : fields).join('; ');
  return `{ ${body} }`;
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
