import { fileURLToPath } from 'node:url';

import type { CollectedFieldType } from '../fields/collect-fields.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type { AnyOptionDef } from '../fields/option.ts';
import type {
  BlocksHint,
  ChildHint,
  ForeignKeyHint,
  JunctionHint,
} from '../fields/storage-hint.ts';
import type { FieldJSONType, FieldValueTypeArgs } from '../fields/value-type.ts';
import type { Message } from '../messages/known-messages.ts';

import {
  indent,
  jsdocBlock,
  literalString,
  propertyKey,
  type TypeImports,
} from '../../utils/codegen/index.ts';
import {
  dirname,
  hasKey,
  isArray,
  isBoolean,
  isNull,
  isNumber,
  isObject,
  isString,
  isUndefined,
  pluralize,
  toSentenceCase,
} from '../../utils/index.ts';
import { resolveAllowedBlocks } from '../blocks/resolve-allowed-blocks.ts';
import { ohneError } from '../error/ohne-error.ts';
import { collectFields } from '../fields/collect-fields.ts';
import { isExpandableDescription, resolveFieldOptions } from '../fields/field.ts';
import {
  type FieldStorageKind,
  resolveFieldStorage,
  type ResolvedFieldStorage,
} from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';
import { fieldBaseType } from '../fields/value-type.ts';
import { resolveMessage } from '../http/translate.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';

/**
 * One emittable field type: its definition plus the directory `importType` paths resolve against.
 */
export interface EmittableFieldType {
  /**
   * The field type's definition.
   */
  fieldType: FieldType;

  /**
   * The directory a relative `importType` path resolves against: the type's own file's directory.
   */
  dir: string;

  /**
   * The file that defines the type; absent for a built-in.
   */
  file?: string;
}

/**
 * The definition a field under emission belongs to, as the error messages name it.
 */
export interface ShapeOwner {
  /**
   * How an error sentence names the owner: its kind, then its name in backticks.
   */
  subject: string;

  /**
   * The file that defines the owner.
   */
  file: string;
}

/**
 * Renders a field's `label` or `description` to concrete text for a static doc comment.
 * A plain string passes through; a message key or `{ key, params }` object renders in the default language.
 * Returns `undefined` when the message resolves to nothing, so the headline can fall back.
 */
export type MessageResolver = (message: Message | undefined) => string | undefined;

/**
 * Everything one field's value type and documentation resolve against.
 */
export interface ShapeContext {
  /**
   * Every emittable field type by name, as `collectFieldTypes` returns them.
   */
  types: ReadonlyMap<string, EmittableFieldType>;

  /**
   * The registered block names a blocks field may allow.
   */
  blocks: readonly string[];

  /**
   * The import collector of the file being generated.
   */
  imports: TypeImports;
}

/**
 * One field's value type, as a `ReadShapeOptions.scalar` hook receives it.
 */
export interface ShapeScalarArgs extends FieldValueTypeArgs<Record<string, AnyOptionDef>> {
  /**
   * The definition the field belongs to.
   */
  owner: ShapeOwner;

  /**
   * The field's path inside its owner: `title`, `seo.title`, or `brewGuide[].tip` inside a list.
   */
  path: string;

  /**
   * The name the field type is registered under.
   */
  type: string;
}

/**
 * One relation field, as a `ReadShapeOptions.relation` hook receives it.
 */
export interface ShapeRelationArgs {
  /**
   * The definition the field belongs to.
   */
  owner: ShapeOwner;

  /**
   * The field's path inside its owner, as `ShapeScalarArgs.path` spells it.
   */
  path: string;

  /**
   * The field instance.
   */
  instance: FieldInstance;

  /**
   * The field's storage hint: a `foreignKey` for one record, a `junction` for a list.
   */
  hint: ForeignKeyHint | JunctionHint;
}

/**
 * One blocks field, as a `ReadShapeOptions.blocksType` hook receives it.
 */
export interface ShapeBlocksArgs {
  /**
   * The definition the field belongs to.
   */
  owner: ShapeOwner;

  /**
   * The field's path inside its owner, as `ShapeScalarArgs.path` spells it.
   */
  path: string;

  /**
   * The block names the field allows, sorted.
   */
  allowed: string[];
}

/**
 * Options for `readShapeType`.
 * Every hook defaults to what the database types emit, so only a different target passes one.
 */
export interface ReadShapeOptions extends ShapeContext {
  /**
   * Whether the field map belongs to a shape a `select` cannot address, like a block's fields.
   *
   * @default
   * false
   */
  nested?: boolean;

  /**
   * Emits a column field's value type, before the walker folds `| null`.
   * A `reason` marks the type degraded, and the field's doc says why.
   *
   * @default
   * fieldBaseType
   */
  scalar?: (args: ShapeScalarArgs) => FieldJSONType;

  /**
   * Emits a `record` or `records` field's whole value type, `| null` included.
   * Omitted, a relation emits its stored `UUID` through `scalar`, as `string` or `string[]`.
   */
  relation?: (args: ShapeRelationArgs) => string;

  /**
   * Emits a blocks field's whole value type.
   * Omitted, a blocks field emits a list over arms whose `fields` index `GeneratedBlocks`.
   */
  blocksType?: (args: ShapeBlocksArgs) => string;

  /**
   * Which `readable: false` fields drop from the shape.
   * `nested` drops them below the top level, where a `select` cannot reach; `always` drops them everywhere.
   *
   * @default
   * 'nested'
   */
  dropHidden?: 'nested' | 'always';

  /**
   * How much each field's doc tells.
   * `full` lists every resolved storage fact.
   * `site` keeps the headline, the type, nullability and translatability.
   *
   * @default
   * 'full'
   */
  docs?: 'full' | 'site';

  /**
   * Renders a field's `label` or `description` for its doc headline.
   * Omitted, it renders through the registered message catalogs in the default language.
   */
  resolveText?: MessageResolver;
}

/**
 * One member of a read shape: the field's name, its value type, and its doc block.
 */
export interface ShapeMember {
  /**
   * The field's name.
   */
  name: string;

  /**
   * The field's value type, `| null` folded in.
   */
  type: string;

  /**
   * The field's doc block, ready to emit above its property.
   */
  doc: string;
}

/**
 * The options a walk runs with, every default applied.
 */
interface ShapeWalk extends ShapeContext {
  scalar: (args: ShapeScalarArgs) => FieldJSONType;
  relation: ((args: ShapeRelationArgs) => string) | undefined;
  blocksType: (args: ShapeBlocksArgs) => string;
  dropHidden: 'nested' | 'always';
  docs: 'full' | 'site';
  resolveText: MessageResolver;
}

/**
 * The directory of the built-in field types, used when a built-in's `importType` resolves a path.
 */
const BUILTIN_DIR = fileURLToPath(new URL('../fields/builtin/', import.meta.url));

/**
 * The doc a composite item's `UUID` carries in a read shape.
 */
export const ITEM_UUID_DOC =
  "This item's unique identifier.\nAssigned when the item is created and never changes.";

/**
 * The docs the structural members of a blocks-union arm carry, by member name.
 */
const BLOCK_ARM_DOCS = {
  block: 'The block type.',
  UUID: "This block instance's unique identifier.",
  fields: "The block's own fields.",
} as const;

/**
 * Resolves one field map into named value types and docs, ready for interface emission.
 *
 * A column field emits through `scalar`, a relation through `relation`, a blocks field through `blocksType`.
 * A composite assembles its inline shape from its subfields, recursively, with an item `UUID` first.
 * A translatable column field reads `null` where a locale holds no translation, so its type folds `| null`.
 * A `readable: false` field drops as `dropHidden` says; a composite's subfield drops always.
 *
 * The defaults reproduce the database types, so a different target overrides only the hooks it changes.
 *
 * @example
 * ```ts
 * readShapeType(
 *   { subject: 'Collection `Posts`', file },
 *   { title: field('text'), tags: field('records', { collection: 'Tags' }) },
 *   { types: await collectFieldTypes(), blocks: [], imports },
 * )
 * // -> [{ name: 'title', type: 'string', doc }, { name: 'tags', type: 'string[]', doc }]
 * ```
 */
export function readShapeType(
  owner: ShapeOwner,
  fields: Record<string, FieldInstance>,
  options: ReadShapeOptions,
): ShapeMember[] {
  const walk: ShapeWalk = {
    types: options.types,
    blocks: options.blocks,
    imports: options.imports,
    scalar: options.scalar ?? fieldBaseType,
    relation: options.relation,
    blocksType: options.blocksType ?? defaultBlocksType,
    dropHidden: options.dropHidden ?? 'nested',
    docs: options.docs ?? 'full',
    resolveText: options.resolveText ?? registeredText,
  };
  const nested = options.nested === true;
  return Object.entries(fields)
    .filter(
      ([name, instance]) =>
        (!nested && walk.dropHidden === 'nested') ||
        resolveEmissionStorage(owner, name, instance, walk).options.readable !== false,
    )
    .map(([name, instance]) => {
      const { type, reason } = valueTypeOf(owner, name, name, instance, walk);
      return {
        name,
        type,
        doc: fieldDocOf(owner, name, instance, walk, false, walk.docs, reason),
      };
    });
}

/**
 * Collects every field type a schema may name, each with the directory its type imports resolve against.
 * Built-ins come first, the stacked layers' own types on top, and `disable.fields` drops its names.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * With `fresh`, each layer type is re-imported past the module cache, so an edit is read again.
 *
 * @example
 * ```ts
 * const types = await collectFieldTypes()
 * types.get('text') // -> { fieldType, dir }
 * ```
 */
export async function collectFieldTypes(
  options: { fresh?: boolean } = {},
): Promise<Map<string, EmittableFieldType>> {
  const disable = useConfig().disable.fields;
  const fields = await collectFields(stackedLayers(), { disable, fresh: options.fresh });
  return emittableFieldTypes(fields, disable);
}

/**
 * Maps every emittable field-type name to its definition: built-ins first, scanned types on top.
 * Disabled names drop the built-in they would otherwise resolve to.
 */
export function emittableFieldTypes(
  fields: readonly CollectedFieldType[],
  disabledFields: readonly string[],
): Map<string, EmittableFieldType> {
  const map = new Map<string, EmittableFieldType>();
  for (const [name, meta] of Object.entries(useFields().all())) {
    map.set(name, { fieldType: meta.fieldType, dir: BUILTIN_DIR });
  }
  for (const name of disabledFields) map.delete(name);
  for (const collected of fields) {
    map.set(collected.name, {
      fieldType: collected.fieldType,
      dir: dirname(collected.file),
      file: collected.file,
    });
  }
  return map;
}

/**
 * Renders a message through the registered catalogs, in the default language outside a request.
 */
function registeredText(message: Message | undefined): string | undefined {
  return isUndefined(message) ? undefined : resolveMessage(message);
}

/**
 * Resolves a field-type name against the emittable set, throwing when the owner references an unknown one.
 */
function registeredType(
  owner: ShapeOwner,
  type: string,
  context: ShapeContext,
): EmittableFieldType {
  const registered = context.types.get(type);
  if (isUndefined(registered)) {
    throw ohneError({
      title: `Unknown field type \`${type}\``,
      body: [`${owner.subject} references field type \`${type}\`, which is not registered.`],
      path: owner.file,
    });
  }
  return registered;
}

/**
 * Resolves one field's storage for emission, throwing when its type is not registered.
 */
export function resolveEmissionStorage(
  owner: ShapeOwner,
  name: string,
  instance: FieldInstance,
  context: ShapeContext,
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
 * Emits one field's value type, resolving its type name against the emittable set.
 * A composite or blocks hint assembles its shape here, where the emittable set is at hand.
 * A relation hint goes to the `relation` hook when the walk has one.
 * A translatable column-bearing field reads `null` where the queried locale holds no translation.
 * Its read shape therefore folds `| null` in whatever its own nullability says.
 * `reason` carries the `scalar` hook's degradation note for the field's doc.
 */
function valueTypeOf(
  owner: ShapeOwner,
  path: string,
  name: string,
  instance: FieldInstance,
  walk: ShapeWalk,
): { type: string; reason?: string } {
  const registered = registeredType(owner, instance.type, walk);
  const { fieldType } = registered;
  if (!isUndefined(fieldType.schema)) {
    const options = resolveFieldOptions(fieldType, { ...instance.options });
    const hint = fieldType.schema({ name, options });
    if (hint.kind === 'child') return { type: childValueType(owner, path, hint, walk) };
    if (hint.kind === 'blocks') {
      const allowed = allowedBlocksOf(owner, name, hint, walk);
      return { type: walk.blocksType({ owner, path, allowed }) };
    }
    if (!isUndefined(walk.relation))
      return { type: walk.relation({ owner, path, instance, hint }) };
  }
  const { base, nullable, reason } = walk.scalar({
    fieldType,
    name,
    options: { ...instance.options },
    fieldDir: registered.dir,
    imports: walk.imports,
    owner,
    path,
    type: instance.type,
  });
  const perLocale = fieldType.columnType !== false && instance.options.translatable === true;
  return { type: nullable || perLocale ? `${base} | null` : base, reason };
}

/**
 * Assembles a documented record shape: `{`, each member's doc then its line, a blank line between members.
 * The shape closes with `closer`, so a caller can fold `| null` or `[]` onto the brace.
 * Each inner line carries its relative indentation; the emission site indents the whole block.
 */
export function documentedShape(
  members: readonly { doc: string; line: string }[],
  closer: string,
): string {
  const lines = ['{'];
  members.forEach((member, i) => {
    if (i > 0) lines.push('');
    lines.push(indent(member.doc), indent(member.line));
  });
  lines.push(closer);
  return lines.join('\n');
}

/**
 * Assembles a composite's inline record shape from its subfields, recursively.
 * The item `UUID` leads the shape, matching the read: every child row exposes its stable identity.
 * `one` cardinality reads back one row or none, so the shape is nullable; `many` is an array.
 * A `select` cannot address a subfield, so a `readable: false` one drops from the shape entirely.
 */
function childValueType(owner: ShapeOwner, path: string, hint: ChildHint, walk: ShapeWalk): string {
  const prefix = hint.cardinality === 'one' ? `${path}.` : `${path}[].`;
  const members = [
    { doc: jsdocBlock(ITEM_UUID_DOC), line: 'UUID: string;' },
    ...Object.entries(hint.subfields)
      .filter(
        ([name, instance]) =>
          resolveEmissionStorage(owner, name, instance, walk).options.readable !== false,
      )
      .map(([name, instance]) => {
        const { type, reason } = valueTypeOf(owner, `${prefix}${name}`, name, instance, walk);
        return {
          doc: fieldDocOf(owner, name, instance, walk, true, walk.docs, reason),
          line: `${propertyKey(name)}: ${type};`,
        };
      }),
  ];
  return documentedShape(members, hint.cardinality === 'one' ? '} | null' : '}[]');
}

/**
 * Resolves a blocks field's allowed type names through the shared resolver, sorted and validated.
 * An empty set or an unregistered name throws, naming the owning definition.
 */
export function allowedBlocksOf(
  owner: ShapeOwner,
  name: string,
  hint: BlocksHint,
  context: ShapeContext,
): string[] {
  const result = resolveAllowedBlocks(hint.allow, context.blocks);
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
 * A multi-line item keeps its shape: the arm's body indents one level past the `|`, its brace under it.
 */
export function blocksListType(items: string[]): string {
  if (items.length === 1) return `${items[0] as string}[]`;
  return ['(', ...items.map(unionArm), ')[]'].join('\n');
}

/**
 * One union arm: `| ` before the item, the item's own lines re-indented to sit past the bar.
 */
function unionArm(item: string): string {
  return `  | ${indent(item, { level: 2 }).slice(4)}`;
}

/**
 * The database read type of a blocks field: an array over the union of its allowed block shapes.
 * Each arm names its block and carries the instance `UUID`.
 * That block's `GeneratedBlocks` member rides as `fields`.
 */
function defaultBlocksType({ allowed }: ShapeBlocksArgs): string {
  return blocksListType(
    allowed.map((block) => blockArm(block, 'GeneratedBlocks', 'UUID: string;')),
  );
}

/**
 * One documented blocks-union arm: the `block` tag, an optional `UUID` line, and the `fields` member.
 * `generated` is the sibling interface the `fields` type indexes into.
 * `uuidLine` is the `UUID` member's line, or `null` for a create arm, which carries none.
 */
export function blockArm(block: string, generated: string, uuidLine: string | null): string {
  const members = [
    { doc: jsdocBlock(BLOCK_ARM_DOCS.block), line: `block: ${literalString(block)};` },
  ];
  if (!isNull(uuidLine)) members.push({ doc: jsdocBlock(BLOCK_ARM_DOCS.UUID), line: uuidLine });
  members.push({
    doc: jsdocBlock(BLOCK_ARM_DOCS.fields),
    line: `fields: ${generated}[${literalString(block)}];`,
  });
  return documentedShape(members, '}');
}

/**
 * Builds one field's documentation block: its headline, a rule, then a bullet list of resolved facts.
 * The headline is the field's `description`, else its `label`, else its name sentence-cased.
 * An expandable description contributes its `text`.
 * `nested` drops the translatability line, which only a top-level collection field can carry.
 * `site` docs list only the type, nullability and translatability.
 * A `reason` adds a line saying the type is `unknown` for want of `emitJSONType`.
 */
export function fieldDocOf(
  owner: ShapeOwner,
  name: string,
  instance: FieldInstance,
  context: ShapeContext & { resolveText: MessageResolver },
  nested: boolean,
  docs: 'full' | 'site' = 'full',
  reason?: string,
): string {
  const { fieldType } = registeredType(owner, instance.type, context);
  const { options, kind } = resolveFieldStorage(name, instance, fieldType);
  const { description } = instance.options;
  const text = isExpandableDescription(description)
    ? context.resolveText(description.text)
    : context.resolveText(description);
  const headline = withPeriod(
    text ?? context.resolveText(instance.options.label) ?? toSentenceCase(name),
  );
  const degraded = isUndefined(reason)
    ? []
    : [`\`unknown\` here: field type \`${instance.type}\` declares no \`emitJSONType\`.`, ''];
  const bullets = fieldBullets(instance, fieldType, options, kind, nested, docs);
  return jsdocBlock([headline, '', ...degraded, '---', '', ...bullets].join('\n'));
}

/**
 * Ends a doc headline with a period, unless it already closes with sentence punctuation.
 * `Title` becomes `Title.`; `The page title.` and `Tagline!` are left as they are.
 */
function withPeriod(headline: string): string {
  return /[.!?]$/.test(headline) ? headline : `${headline}.`;
}

/**
 * The resolved-config bullets a field's doc lists.
 * Type, nullability, and index come first, then translatability for a top-level field.
 * The value behaviour the author set at the call site follows, then the field type's own options.
 * `site` docs stop after translatability and skip the index, which a website cannot use.
 */
function fieldBullets(
  instance: FieldInstance,
  fieldType: FieldType,
  options: ResolvedFieldStorage['options'],
  kind: FieldStorageKind,
  nested: boolean,
  docs: 'full' | 'site',
): string[] {
  const bullets = [`Type: ${inlineCode(instance.type)}`];
  bullets.push(fieldNullable(kind, options, fieldType) ? 'Nullable' : 'Not nullable');
  const index = docs === 'full' ? indexBullet(kind, options, fieldType) : null;
  if (!isNull(index)) bullets.push(index);
  if (!nested) bullets.push(options.translatable === true ? 'Translatable' : 'Not translatable');
  if (docs === 'full') {
    bullets.push(hasKey(instance.options, 'default') ? 'Has a default value' : 'No default value');
    bullets.push(countBullet(instance.options.sanitizers?.length ?? 0, 'sanitizer'));
    bullets.push(countBullet(instance.options.validators?.length ?? 0, 'validator'));
    bullets.push(hasKey(instance.options, 'when') ? 'Conditional' : 'No condition');
    bullets.push(...typeSpecificBullets(fieldType, options));
  }
  return bullets.map((bullet) => `- ${bullet}`);
}

/**
 * Whether the field itself permits `null`: a lone child row or a nullable-or-forced column, never a list.
 * A translatable column also reads `null` per missing locale, which the translatability line already conveys.
 */
function fieldNullable(
  kind: FieldStorageKind,
  options: ResolvedFieldStorage['options'],
  fieldType: FieldType,
): boolean {
  if (kind === 'childOne') return true;
  if (kind === 'childMany' || kind === 'junction' || kind === 'blocks') return false;
  return options.nullable === true || fieldType.forceNullable === true;
}

/**
 * The index bullet of a column-bearing field: its unique scope, a plain index, or `No index`; else `null`.
 */
function indexBullet(
  kind: FieldStorageKind,
  options: ResolvedFieldStorage['options'],
  fieldType: FieldType,
): string | null {
  if (kind !== 'column' && kind !== 'foreignKey') return null;
  if (options.uniquePerLocale === true) return 'Unique per locale';
  if (options.uniquePerParent === true) return 'Unique per parent';
  if (options.unique === true) return 'Unique';
  if (options.index === true || fieldType.forceIndex === true) return 'Indexed';
  return 'No index';
}

/**
 * A count bullet for how many of one thing a field carries: `No sanitizers`, `1 validator`, `2 validators`.
 */
function countBullet(count: number, noun: string): string {
  return count === 0 ? `No ${noun}s` : `${count} ${pluralize(count, noun)}`;
}

/**
 * The bullets for a field type's own declared options, each rendered from its resolved value.
 * An option absent after resolution is skipped, so only the options the field actually carries show.
 */
function typeSpecificBullets(
  fieldType: FieldType,
  options: ResolvedFieldStorage['options'],
): string[] {
  const bullets: string[] = [];
  for (const key of Object.keys(fieldType.options ?? {})) {
    const value = options[key];
    if (isUndefined(value)) continue;
    bullets.push(`${inlineCode(key)} ${describeOptionValue(value)}`);
  }
  return bullets;
}

/**
 * Describes one resolved option value for a bullet: a scalar shows its value, a list or record its size.
 */
function describeOptionValue(value: unknown): string {
  if (isArray(value)) return `has ${value.length} ${pluralize(value.length, 'entry', 'entries')}`;
  if (isString(value) || isNumber(value) || isBoolean(value)) {
    return `is ${inlineCode(String(value))}`;
  }
  if (isObject(value)) {
    const size = Object.keys(value).length;
    return `has ${size} ${pluralize(size, 'entry', 'entries')}`;
  }
  return 'is set';
}

/**
 * Wraps a value in backticks, so the generated doc comment renders it as inline code.
 */
function inlineCode(value: string): string {
  return `\`${value}\``;
}
