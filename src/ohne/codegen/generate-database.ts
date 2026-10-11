import type { CollectedBlock } from '../blocks/collect-blocks.ts';
import type { CollectedCollection } from '../collections/collect-collections.ts';
import type { ScannedMigration } from '../database/migrations/scan-layer-migrations.ts';
import type { CollectedFieldType } from '../fields/collect-fields.ts';
import type { FieldInstance } from '../fields/field.ts';
import type {
  BlocksHint,
  ChildHint,
  ForeignKeyHint,
  JunctionHint,
} from '../fields/storage-hint.ts';
import type { MessageMeta } from '../messages/messages.ts';

import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
  createTypeImports,
  importSpecifier,
  jsdocBlock,
  literalString,
  propertyKey,
} from '../../utils/codegen/index.ts';
import {
  formatMessage,
  hasKey,
  isArray,
  isNull,
  isObject,
  isString,
  isUndefined,
  joinPath,
} from '../../utils/index.ts';
import { collectBlocks } from '../blocks/collect-blocks.ts';
import { collectCollections } from '../collections/collect-collections.ts';
import { resolveLocales } from '../collections/resolve-locales.ts';
import { collectMigrations } from '../database/migrations/collect-migrations.ts';
import { ohneError } from '../error/ohne-error.ts';
import { collectFields } from '../fields/collect-fields.ts';
import { resolveFieldOptions } from '../fields/field.ts';
import { forbidsEmpty } from '../fields/forbids-empty.ts';
import { resolveFieldStorage } from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';
import { fieldBaseType } from '../fields/value-type.ts';
import { DEFAULTS } from '../layers/config.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { collectMessages } from '../messages/collect-messages.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';
import {
  allowedBlocksOf,
  blockArm,
  blocksListType,
  documentedShape,
  type EmittableFieldType,
  emittableFieldTypes,
  fieldDocOf,
  ITEM_UUID_DOC,
  type MessageResolver,
  readShapeType,
  resolveEmissionStorage,
  type ShapeContext,
  type ShapeOwner,
} from './read-shape.ts';

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
 * Everything one field's value type and documentation resolve against, its doc headlines included.
 */
type EmissionContext = ShapeContext & { resolveText: MessageResolver };

/**
 * The `UUID` entry every collection and composite scope leads its query-field table with.
 */
const UUID_QUERY_ENTRY = '{ scalar: string; id: true }';

/**
 * The `_updatedAt` entry every collection carries in its query-field table.
 */
const UPDATED_AT_QUERY_ENTRY = '{ scalar: number }';

/**
 * The `_translations` entry a translatable collection carries in its query-field table.
 */
const TRANSLATIONS_QUERY_ENTRY = '{ translations: true }';

/**
 * The operations every collection contributes a `collection.<Name>.<operation>` capability for.
 */
const CAPABILITY_OPERATIONS = ['read', 'create', 'update', 'delete'] as const;

/**
 * The doc a collection's read-shape `UUID` carries.
 */
const RECORD_UUID_DOC =
  "This record's unique identifier.\nAssigned when the record is created and never changes.";

/**
 * The doc a collection's read-shape `_updatedAt` carries.
 */
const UPDATED_AT_DOC =
  'When this record was last updated, as a Unix timestamp in milliseconds.\nMaintained automatically.';

/**
 * The doc a translatable collection's read-shape `_translations` carries.
 */
const TRANSLATIONS_DOC =
  'The locales holding a translation of this record, in configured order.\nNo write accepts it.';

/**
 * Generates the database types and registrations from every layer's schema directories.
 *
 * `shared/database.ts` carries the pure types: `GeneratedCollections`, `GeneratedBlocks`, and friends.
 * `node/database.ts` imports every collection, block, field-type, and migration definition.
 * Importing it registers them all.
 * It also augments each `Known*` that `shared/database.ts` backs, and `KnownFields` per custom field type.
 * `browser/collections.ts` extends `ohnejs/dashboard`'s `KnownCollections`, so the browser knows the names.
 * Migration registration order is the execution order: furthest layer first, name order within a layer.
 * Every file is written even when empty, so a stale one never imports deleted files.
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
  const [collections, fields, blocks, migrations, messages] = await Promise.all([
    collectCollections(stackedLayers(), { disable: disable.collections, fresh }),
    collectFields(stackedLayers(), { disable: disable.fields, fresh }),
    collectBlocks(stackedLayers(), { disable: disable.blocks, fresh }),
    collectMigrations(stackedLayers()),
    collectMessages(stackedLayers(), { disable: disable.messages }),
  ]);
  const resolveText = messageResolver(messages);

  return Promise.all([
    writeShared(
      joinPath(dir, 'shared'),
      collections,
      fields,
      blocks,
      disable.fields,
      helpers,
      locales,
      resolveText,
    ),
    writeNode(joinPath(dir, 'node'), collections, fields, blocks, migrations, disable.fields),
    writeBrowser(joinPath(dir, 'browser')),
  ]);
}

/**
 * Builds the field-doc message resolver from the collected catalogs.
 * Only the default language renders, since a doc comment is static and single-language.
 * A plain string that names no key passes through.
 * A key with no default-language template resolves to nothing, so the headline falls back in turn.
 */
function messageResolver(messages: readonly MessageMeta[]): MessageResolver {
  const language = useConfig().messages?.defaultLanguage ?? DEFAULTS.messages.defaultLanguage;
  const templates = new Map<string, string>();
  for (const message of messages) {
    if (message.language === language) templates.set(message.key, message.template);
  }
  return (message) => {
    if (isUndefined(message)) return undefined;
    if (isString(message)) {
      const template = templates.get(message);
      return isUndefined(template) ? message : formatMessage(template, undefined, language);
    }
    const { key, params } = message;
    const template = templates.get(key);
    return isUndefined(template) ? undefined : formatMessage(template, params, language);
  };
}

/**
 * Writes `shared/database.ts`, the pure type bucket holding every `Generated*` type this generator emits.
 * `GeneratedCapabilities` derives the capability names from the collection set.
 * A singleton contributes no `create` or `delete` name, and `GeneratedSingletons` lists it.
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
  resolveText: MessageResolver,
): Promise<string> {
  const imports = createTypeImports(dir);
  const context: EmissionContext = {
    types: emittableFieldTypes(fields, disabledFields),
    blocks: blocks.map((block) => block.name),
    imports,
    resolveText,
  };
  const translatable = translatableCollections(collections, context);
  const translations = translationsType(locales);
  const members = collections.map((collection) => ({
    name: collection.name,
    fields: [
      { name: 'UUID', type: 'string', doc: jsdocBlock(RECORD_UUID_DOC) },
      { name: '_updatedAt', type: 'number', doc: jsdocBlock(UPDATED_AT_DOC) },
      ...(translatable.has(collection.name)
        ? [{ name: '_translations', type: translations, doc: jsdocBlock(TRANSLATIONS_DOC) }]
        : []),
      ...readShapeType(
        { subject: `Collection \`${collection.name}\``, file: collection.file },
        collection.collection.fields,
        context,
      ),
    ],
    relations: owningRelationsOf(collection, context.types),
  }));
  const blockMembers = blocks.map((block) => ({
    name: block.name,
    fields: readShapeType(
      { subject: `Block \`${block.name}\``, file: block.file },
      block.block.fields,
      {
        ...context,
        nested: true,
      },
    ),
  }));
  const queryMembers = collections.map((collection) => ({
    name: collection.name,
    fields: [
      { name: 'UUID', type: UUID_QUERY_ENTRY },
      { name: '_updatedAt', type: UPDATED_AT_QUERY_ENTRY },
      ...(translatable.has(collection.name)
        ? [{ name: '_translations', type: TRANSLATIONS_QUERY_ENTRY }]
        : []),
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
  code.line('export interface GeneratedCapabilities {');
  code.indent(() => {
    code.line("'*': true;");
    code.line("'collection.*': true;");
    for (const collection of collections) {
      const singleton = collection.collection.singleton === true;
      for (const operation of CAPABILITY_OPERATIONS) {
        if (singleton && (operation === 'create' || operation === 'delete')) continue;
        code.line(`'collection.${collection.name}.${operation}': true;`);
      }
      code.line(`'collection.${collection.name}.*': true;`);
    }
  });
  code.line('}');
  code.line();
  const singletons = collections.filter((collection) => collection.collection.singleton === true);
  if (singletons.length === 0) {
    code.line('export interface GeneratedSingletons {}');
  } else {
    code.line('export interface GeneratedSingletons {');
    code.indent(() => {
      for (const { name } of singletons) code.line(`${propertyKey(name)}: true;`);
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
 * The names of the collections holding a translatable field, by the rule the runtime metadata applies.
 * The declared fields alone decide: an inverse junction never declares the option itself.
 */
function translatableCollections(
  collections: readonly CollectedCollection[],
  context: EmissionContext,
): Set<string> {
  const names = collections
    .filter(({ name, file, collection }) =>
      Object.entries(collection.fields).some(
        ([field, instance]) =>
          resolveEmissionStorage(
            { subject: `Collection \`${name}\``, file },
            field,
            instance,
            context,
          ).options.translatable === true,
      ),
    )
    .map((collection) => collection.name);
  return new Set(names);
}

/**
 * The read type of `_translations`: a list over the configured locale codes.
 * A lone locale stays bare; several union inside parentheses, as a blocks list does.
 */
function translationsType(locales: readonly string[]): string {
  const codes = locales.map((locale) => literalString(locale));
  return codes.length === 1 ? `${codes[0] as string}[]` : `(${codes.join(' | ')})[]`;
}

/**
 * Emits one interface member: the name, then its field shape, `{}` when the definition holds none.
 * Each field carries its doc block above it when one is set.
 */
function emitFieldShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string; doc?: string }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    fields.forEach((field, i) => {
      if (i > 0 && field.doc) code.line();
      if (field.doc) code.line(field.doc);
      code.line(`${propertyKey(field.name)}: ${field.type};`);
    });
  });
  code.line('};');
}

/**
 * Emits one input member: each field's name, an optional marker, and its input type.
 * A nullable-or-defaulted field is optional; a required field is not.
 * The block update table rides it too: a provided item is a full item, so create optionality holds.
 * Each field carries its doc block above it when one is set.
 */
function emitInsertShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string; optional: boolean; doc?: string }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    fields.forEach((field, i) => {
      if (i > 0 && field.doc) code.line();
      if (field.doc) code.line(field.doc);
      code.line(`${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type};`);
    });
  });
  code.line('};');
}

/**
 * Emits one update-input member: each field's name, always optional, and its input type.
 * Each field carries its doc block above it when one is set.
 */
function emitUpdateShapes(
  code: CodeBuilder,
  name: string,
  fields: readonly { name: string; type: string; doc?: string }[],
): void {
  if (fields.length === 0) {
    code.line(`${propertyKey(name)}: {};`);
    return;
  }
  code.line(`${propertyKey(name)}: {`);
  code.indent(() => {
    fields.forEach((field, i) => {
      if (i > 0 && field.doc) code.line();
      if (field.doc) code.line(field.doc);
      code.line(`${propertyKey(field.name)}?: ${field.type};`);
    });
  });
  code.line('};');
}

/**
 * Writes `node/database.ts`: imports every definition, augments `ohnejs`, and registers each one.
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
    code.line(`import { ${uses.join(', ')} } from 'ohnejs';`);
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
    "import type { GeneratedBlockQueryFields, GeneratedBlocks, GeneratedCapabilities, GeneratedCollections, GeneratedDatabases, GeneratedInserts, GeneratedLocales, GeneratedQueryFields, GeneratedRelations, GeneratedSingletons, GeneratedUpdates } from '../shared/database.ts';",
  );
  code.line();
  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    code.line('interface KnownCollections extends GeneratedCollections {}');
    code.line('interface KnownRelations extends GeneratedRelations {}');
    code.line('interface KnownSingletons extends GeneratedSingletons {}');
    code.line('interface KnownQueryFields extends GeneratedQueryFields {}');
    code.line('interface KnownBlockQueryFields extends GeneratedBlockQueryFields {}');
    code.line('interface KnownInserts extends GeneratedInserts {}');
    code.line('interface KnownUpdates extends GeneratedUpdates {}');
    code.line('interface KnownBlocks extends GeneratedBlocks {}');
    code.line('interface KnownDatabases extends GeneratedDatabases {}');
    code.line('interface KnownLocales extends GeneratedLocales {}');
    code.line('interface KnownCapabilities extends GeneratedCapabilities {}');
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

/**
 * Writes `browser/collections.ts`: augments `ohnejs/dashboard` so `CollectionName` narrows to known names.
 * Its shape is constant; it only wires the shared type onto the browser's interface.
 */
async function writeBrowser(dir: string): Promise<string> {
  const code = createCodeBuilder();
  code.line("import type {} from 'ohnejs/dashboard';");
  code.line("import type { GeneratedCollections } from '../shared/database.ts';");
  code.line();
  code.line("declare module 'ohnejs/dashboard' {");
  code.indent(() => {
    code.line('interface KnownCollections extends GeneratedCollections {}');
  });
  code.line('}');
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('collections.ts', code.toString());
  return gen.path('collections.ts');
}

/**
 * Writes `database.ts` into `dir` when its contents changed, returning its absolute path either way.
 */
async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('database.ts', code.toString());
  return gen.path('database.ts');
}

/**
 * Resolves one collection or composite field map into named `QueryFieldMeta` type literals.
 */
function queryFieldsOf(
  owner: ShapeOwner,
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
  owner: ShapeOwner,
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
  const hidden = resolved.options.readable === false;
  const when = hasKey(instance.options, 'when') ? conditionLiteral(instance.options.when) : null;

  if (kind === 'blocks') {
    const allowed = allowedBlocksOf(owner, name, hint as BlocksHint, context);
    return metaLiteral(
      [
        `blocks: ${allowed.map((block) => literalString(block)).join(' | ')}`,
        ...(hidden ? ['readable: false'] : []),
        ...(translatable ? ['localeScoped: true'] : []),
      ],
      when,
    );
  }
  if (kind === 'junction') {
    return metaLiteral(
      [
        `records: ${literalString((hint as JunctionHint).collection)}`,
        ...(hidden ? ['readable: false'] : []),
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
        ...(hidden ? ['readable: false'] : []),
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
  if (registered.fieldType.jsonList === true) parts.push('jsonList: true');
  if (hidden) parts.push('readable: false');
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
 * Renders a `when` condition object as a TypeScript type literal.
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
 * `nested` is `true` for a composite's subfields, so their docs drop the top-level translatability line.
 * A `writable: false` field never appears in a write input, so it drops from the shape.
 */
function insertShapesOf(
  owner: ShapeOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
  nested = false,
): { name: string; type: string; optional: boolean; doc: string }[] {
  return Object.entries(fields)
    .filter(
      ([name, instance]) =>
        resolveEmissionStorage(owner, name, instance, context).options.writable !== false,
    )
    .map(([name, instance]) => ({
      name,
      ...insertFieldType(owner, name, instance, context),
      doc: fieldDocOf(owner, name, instance, context, nested),
    }));
}

/**
 * The input value type of one column or `record` field, `| null` folded in when the field is nullable.
 * Shared by the create and update shapes, which differ only in optionality and item identity.
 */
function inputScalarType(
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
  resolved: ReturnType<typeof resolveEmissionStorage>,
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
 * Whether a create may omit a list field: it declares a `default`, or its options admit the empty `[]`.
 * A gated list stays optional, since a create whose gate is off lands `[]` without it.
 */
function listOptional(options: Readonly<Record<string, unknown>>): boolean {
  return hasKey(options, 'default') || hasKey(options, 'when') || !forbidsEmpty(options);
}

/**
 * Whether a column field is defaulted: by its own `default`, or by its type's `defaultValue`.
 * A `jsonList` type's default is read as its empty list, which a field that `forbidsEmpty` cannot take.
 * A gated one still takes it, as its inactive fallback.
 */
function columnDefaulted(
  options: Readonly<Record<string, unknown>>,
  fieldType: { defaultValue?: unknown; jsonList?: true },
): boolean {
  if (hasKey(options, 'default')) return true;
  if (isUndefined(fieldType.defaultValue)) return false;
  return !(fieldType.jsonList === true && forbidsEmpty(options)) || hasKey(options, 'when');
}

/**
 * Emits one field's create-input type and whether it is optional.
 *
 * A column or `record` takes its value type, optional when nullable or defaulted.
 * A `records` list is optional and defaults to `[]`; an `object` is optional and accepts `null`.
 * A `repeater` is an optional list of item shapes; a create item carries no `UUID`.
 * A blocks field is an optional list of `{ block; fields }` envelopes, defaulting to `[]`.
 * A list that `forbidsEmpty` is required instead, as `listOptional` decides.
 * `fields` references the type's `GeneratedBlockInserts` member, so self-nesting terminates.
 */
function insertFieldType(
  owner: ShapeOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): { type: string; optional: boolean } {
  const resolved = resolveEmissionStorage(owner, name, instance, context);
  const { hint, kind, options } = resolved;
  if (kind === 'blocks') {
    const items = allowedBlocksOf(owner, name, hint as BlocksHint, context).map((block) =>
      blockArm(block, 'GeneratedBlockInserts', null),
    );
    return { type: blocksListType(items), optional: listOptional(options) };
  }
  if (kind === 'junction') return { type: 'string[]', optional: listOptional(options) };
  if (kind === 'childOne') {
    return {
      type: `${insertObjectType(owner, hint as ChildHint, context)} | null`,
      optional: true,
    };
  }
  if (kind === 'childMany') {
    return {
      type: `${insertObjectType(owner, hint as ChildHint, context)}[]`,
      optional: listOptional(options),
    };
  }

  const defaulted = columnDefaulted(options, resolved.registered.fieldType);
  const { type, nullable } = inputScalarType(name, instance, context, resolved);
  return { type, optional: nullable || defaulted };
}

/**
 * Emits a composite item's create-input object type from its subfields, each documented.
 */
function insertObjectType(owner: ShapeOwner, hint: ChildHint, context: EmissionContext): string {
  const members = insertShapesOf(owner, hint.subfields, context, true).map((field) => ({
    doc: field.doc,
    line: `${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type};`,
  }));
  return documentedShape(members, '}');
}

/**
 * Resolves one field map into named update-input shapes.
 * `nested` is `true` for a composite's subfields, so their docs drop the top-level translatability line.
 * A `writable: false` or `immutable` field never appears in an update input, so it drops from the shape.
 */
function updateShapesOf(
  owner: ShapeOwner,
  fields: Record<string, FieldInstance>,
  context: EmissionContext,
  nested = false,
): { name: string; type: string; optional: boolean; doc: string }[] {
  return Object.entries(fields)
    .filter(([name, instance]) => {
      const { options } = resolveEmissionStorage(owner, name, instance, context);
      return options.writable !== false && options.immutable !== true;
    })
    .map(([name, instance]) => ({
      name,
      ...updateFieldType(owner, name, instance, context),
      doc: fieldDocOf(owner, name, instance, context, nested),
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
  owner: ShapeOwner,
  name: string,
  instance: FieldInstance,
  context: EmissionContext,
): { type: string; optional: boolean } {
  const resolved = resolveEmissionStorage(owner, name, instance, context);
  const { hint, kind, options } = resolved;
  if (kind === 'blocks') {
    const items = allowedBlocksOf(owner, name, hint as BlocksHint, context).map((block) =>
      blockArm(block, 'GeneratedBlockUpdates', 'UUID?: string;'),
    );
    return { type: blocksListType(items), optional: listOptional(options) };
  }
  if (kind === 'junction') return { type: 'string[]', optional: listOptional(options) };
  if (kind === 'childOne') {
    return {
      type: `${updateObjectType(owner, hint as ChildHint, context, false)} | null`,
      optional: true,
    };
  }
  if (kind === 'childMany') {
    return {
      type: `${updateObjectType(owner, hint as ChildHint, context, true)}[]`,
      optional: listOptional(options),
    };
  }
  const defaulted = columnDefaulted(options, resolved.registered.fieldType);
  const { type, nullable } = inputScalarType(name, instance, context, resolved);
  return { type, optional: nullable || defaulted };
}

/**
 * Emits a composite item's update-input object type, each subfield documented at its create-time optionality.
 * A repeater item leads with `UUID?: string`, so a matched item keeps its identity across the update.
 */
function updateObjectType(
  owner: ShapeOwner,
  hint: ChildHint,
  context: EmissionContext,
  identified: boolean,
): string {
  const subfields = updateShapesOf(owner, hint.subfields, context, true).map((field) => ({
    doc: field.doc,
    line: `${propertyKey(field.name)}${field.optional ? '?' : ''}: ${field.type};`,
  }));
  const members = identified
    ? [{ doc: jsdocBlock(ITEM_UUID_DOC), line: 'UUID?: string;' }, ...subfields]
    : subfields;
  return documentedShape(members, '}');
}

/**
 * Collects one collection's owning relation fields: junction hints without `inverse`.
 * These become the collection's `GeneratedRelations` member, each mapped to its target's name.
 * Top-level collection fields only, by contract - the map never descends into subfields.
 */
function owningRelationsOf(
  collection: CollectedCollection,
  types: ReadonlyMap<string, EmittableFieldType>,
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
