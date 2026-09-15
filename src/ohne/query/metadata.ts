import type { ConditionError, ConditionNode } from '../../utils/index.ts';
import type { CollectionMeta } from '../collections/use-collections.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type {
  BlocksHint,
  ChildHint,
  ForeignKeyHint,
  JunctionHint,
} from '../fields/storage-hint.ts';

import { hasKey, isUndefined, parseCondition } from '../../utils/index.ts';
import { resolveAllowedBlocks } from '../blocks/resolve-allowed-blocks.ts';
import { useBlocks } from '../blocks/use-blocks.ts';
import { useCollections } from '../collections/use-collections.ts';
import {
  blockRootName,
  blockTableName,
  collectionTableName,
  companionTableName,
  derivedTableName,
} from '../database/naming/table-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveFieldStorage } from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';
import { validateBlockWhen, validateWhen } from './validate-when.ts';

/**
 * The query-facing shape of one field: where its value lives and how a condition may address it.
 * Column kinds carry their column and logical type.
 * Relation kinds carry their target; derived kinds their table.
 */
export interface FieldQueryMeta {
  /**
   * How the field stores and reads.
   * A plain column, a `record` reference, a `records` relation, a child table, or a blocks wrapper.
   * `childOne` holds one child row per parent, `childMany` many.
   * `translations` is the read-only locale list of a translatable collection, probed from its `tables`.
   */
  kind: 'column' | 'record' | 'records' | 'childOne' | 'childMany' | 'blocks' | 'translations';

  /**
   * The registered field type, carrying the pipeline hooks; absent on the system entries.
   */
  fieldType?: FieldType;

  /**
   * The resolved instance options, frozen once at metadata build and shared by every consumer.
   * Absent on the system entries.
   */
  options?: Readonly<Record<string, unknown>>;

  /**
   * Whether the field's value shape admits `null`.
   * Column kinds read the resolved option, `forceNullable` folded.
   * `childOne` is always nullable; `records`, `childMany`, and `translations` never are.
   */
  nullable: boolean;

  /**
   * The storage primitive of the field's column; column-bearing kinds (`column`, `record`) only.
   */
  logicalType?: LogicalType;

  /**
   * The physical column holding the value; column-bearing kinds only.
   */
  column?: string;

  /**
   * Marks the `UUID` entries, restricting them to the identity operators.
   */
  id?: true;

  /**
   * Marks a `json` column holding a list, unlocking the `includes*` operators.
   */
  jsonList?: true;

  /**
   * Marks a write-only field: reads skip it unless a select names it explicitly.
   * The wire refuses it everywhere a read could address it.
   */
  readable?: false;

  /**
   * Marks a framework-written field the wire refuses in create and update bodies.
   */
  writable?: false;

  /**
   * Marks a field locked after create; the wire refuses it in update bodies.
   */
  immutable?: true;

  /**
   * Marks a translatable column-bearing field: its column lives on the collection's companion table.
   * It holds one value per locale and reads `null` when the queried locale has no translation.
   */
  companion?: true;

  /**
   * Marks a translatable derived table: its rows carry `_localeCode`.
   * Every read and write addresses one locale's rows.
   */
  localeScoped?: true;

  /**
   * The target collection, by name; relation kinds (`record`, `records`) only.
   */
  target?: string;

  /**
   * Marks the inverse side of a `records` relation, reading the owner's junction with roles swapped.
   */
  inverse?: true;

  /**
   * The derived table the values live in.
   * A `records` junction, a composite's child table, or a `blocks` field's wrapper.
   */
  table?: string;

  /**
   * The locale-scoped tables a `translations` entry probes: the companion, then every owned derived table.
   * Their rows carry `_parentUUID` and `_localeCode`; a record holds a locale when any table lists it there.
   */
  tables?: readonly string[];

  /**
   * The child table's own fields, its item `UUID` included; child kinds only.
   */
  subfields?: Record<string, FieldQueryMeta>;

  /**
   * The resolved block types the field admits, sorted; `blocks` kind only.
   * Each type's own table and subfields resolve through `blockQueryMetadata`.
   */
  allow?: readonly string[];

  /**
   * The field's parsed `when` condition, present when the instance declares one.
   * Its paths resolve in the field's own scope, so the pipeline reads the same node every write.
   */
  when?: ConditionNode;
}

/**
 * A collection-level `unique` composite the write pipeline prechecks before a write.
 * Resolved from each `compositeIndexes` entry whose `unique` is set.
 */
export interface CompositeUnique {
  /**
   * The covered field names in declaration order; each is column-bearing, so its name is its column.
   */
  fields: readonly string[];

  /**
   * Whether the constraint lives on the companion table - `true` iff every covered field is translatable.
   */
  companion: boolean;
}

/**
 * Everything the query layer knows about one collection.
 */
export interface CollectionQueryMeta {
  /**
   * The collection's name.
   */
  collection: string;

  /**
   * The collection's main table.
   */
  table: string;

  /**
   * Every addressable field in order: the system entries, then the declared fields as authored.
   * The system entries are `UUID`, `_updatedAt`, and `_translations` on a translatable collection.
   */
  fields: Record<string, FieldQueryMeta>;

  /**
   * The collection's `unique` composites, resolved to their fields and home table; empty when none.
   * The write pipeline prechecks each before it writes, keying a collision at every covered field.
   */
  compositeUniques: readonly CompositeUnique[];

  /**
   * Marks a collection with at least one translatable field - the collections `.locale()` accepts.
   */
  translatable?: true;

  /**
   * The `<Owner>__translations` table holding the translatable columns, one row per (record, locale).
   * Present when at least one translatable field carries a column.
   */
  companionTable?: string;
}

/**
 * The per-collection memo.
 * Dev respawn reimports every module, so the memo lives and dies with the registries.
 */
const cache = new Map<string, CollectionQueryMeta>();

/**
 * Returns the query metadata of one collection, built lazily and memoized per process.
 *
 * The single runtime source the compiler, loaders, pipeline, and wire validation read.
 * Built from the collection and field-type registries through the shared field-walk.
 * It therefore partitions fields exactly as the desired schema does.
 * Building validates every declared `when` against the field graph, so a bad condition throws here.
 * An unknown collection throws.
 *
 * @example
 * ```ts
 * queryMetadata('Posts')
 * // -> { collection: 'Posts', table: 'Posts', fields: { UUID: {...}, ... } }
 * ```
 */
export function queryMetadata(collection: string): CollectionQueryMeta {
  const cached = cache.get(collection);
  if (!isUndefined(cached)) return cached;
  const meta = useCollections().get(collection);
  if (isUndefined(meta)) throw ohneError(`Unknown collection \`${collection}\``);
  const built = buildCollectionMeta(meta);
  validateWhen(built);
  cache.set(collection, built);
  return built;
}

/**
 * Builds and caches every collection's and every registered block's query metadata.
 * Each declared `when` validates in the process.
 *
 * Run at boot so a malformed or misaddressed `when` fails before the server serves, not on a first write.
 * The build is memoized, so this warms the cache every later read and write then reuses.
 */
export function warmQueryMetadata(): void {
  for (const meta of Object.values(useCollections().all())) queryMetadata(meta.name);
  for (const name of useBlocks().keys()) blockQueryMetadata(name);
}

/**
 * Everything the query layer knows about one block type.
 * Blocks are global - wrapper fields reference them by name.
 * The metadata therefore resolves once per block, never per use site.
 */
export interface BlockQueryMeta {
  /**
   * The block's name.
   */
  name: string;

  /**
   * The block's shared per-type table.
   */
  table: string;

  /**
   * Every addressable subfield in order: the item `UUID`, then the declared fields as authored.
   */
  fields: Record<string, FieldQueryMeta>;
}

/**
 * The per-block memo, living and dying with the registries exactly as the collection cache does.
 */
const blockCache = new Map<string, BlockQueryMeta>();

/**
 * Returns the query metadata of one block type, built lazily and memoized per process.
 *
 * The runtime twin of a `blocks` field's per-type view.
 * The compiler scopes a discriminated `has` through it and the loaders hydrate instances from it.
 * The pipeline descends its fields.
 * Building validates every declared `when` block-scoped: bare sibling paths only, anchors rejected.
 * An unknown block throws.
 */
export function blockQueryMetadata(block: string): BlockQueryMeta {
  const cached = blockCache.get(block);
  if (!isUndefined(cached)) return cached;
  const meta = useBlocks().get(block);
  if (isUndefined(meta)) throw ohneError(`Unknown block \`${block}\``);
  const fields: Record<string, FieldQueryMeta> = Object.assign(Object.create(null), {
    UUID: uuidEntry(),
  });
  addFieldEntries(fields, meta.block.fields, blockRootName(block), `block \`${block}\``);
  const built = { name: block, table: blockTableName(block), fields };
  assertNoCascadeInBlock(block, fields, '');
  validateBlockWhen(block, fields);
  blockCache.set(block, built);
  return built;
}

/**
 * Rejects a `record` subfield with `onDelete: 'cascade'` anywhere inside a block's field tree.
 *
 * A block's per-type row hangs beneath a polymorphic wrapper that carries no foreign key.
 * A cascade would doom rows only the write layer knows how to clean, leaving wrappers dangling.
 * Every read of an owning collection would then throw on the dangling reference.
 */
function assertNoCascadeInBlock(
  block: string,
  fields: Record<string, FieldQueryMeta>,
  prefix: string,
): void {
  for (const [name, field] of Object.entries(fields)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (field.kind === 'record' && field.options?.onDelete === 'cascade') {
      throw ohneError({
        title: `Block \`${block}\` cascades \`${path}\` under its wrapper`,
        body: [
          `Field \`${path}\` in block \`${block}\` sets \`onDelete: 'cascade'\`.`,
          'A cascade under a polymorphic wrapper dooms rows the write layer must clean itself.',
          'A delete of the referenced record would leave dangling wrappers that break every read.',
          'Use `setNull` or `restrict` instead.',
        ],
      });
    }
    if (field.kind === 'childOne' || field.kind === 'childMany') {
      assertNoCascadeInBlock(block, field.subfields as Record<string, FieldQueryMeta>, path);
    }
  }
}

/**
 * The `UUID` entry every collection and child scope leads with: identity-only, never null.
 */
function uuidEntry(): FieldQueryMeta {
  return { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true };
}

/**
 * Builds one collection's metadata: the system entries, then the declared fields in order.
 * A field marked `companion` raises the companion table; any owned locale marker raises `translatable`.
 * An inverse view into a locale-scoped junction does not: the owner's option is not this collection's.
 * A translatable collection seeds `_translations`, its `tables` the companion then every owned scoped table.
 */
function buildCollectionMeta(meta: CollectionMeta): CollectionQueryMeta {
  const declared: Record<string, FieldQueryMeta> = Object.create(null);
  addFieldEntries(declared, meta.collection.fields, meta.name, `collection \`${meta.name}\``);
  const entries = Object.values(declared);
  const companion = entries.some((field) => field.companion === true);
  const tables = [
    ...(companion ? [companionTableName(meta.name)] : []),
    ...entries
      .filter((field) => field.localeScoped === true && field.inverse !== true)
      .map((field) => field.table as string),
  ];
  const translatable = tables.length > 0;
  const fields: Record<string, FieldQueryMeta> = Object.assign(Object.create(null), {
    UUID: uuidEntry(),
    _updatedAt: { kind: 'column', nullable: false, logicalType: 'integer', column: '_updatedAt' },
    ...(translatable
      ? { _translations: { kind: 'translations', nullable: false, tables: Object.freeze(tables) } }
      : {}),
    ...declared,
  });
  const compositeUniques = (meta.collection.compositeIndexes ?? [])
    .filter((entry) => entry.unique === true)
    .map((entry) => ({
      fields: entry.fields,
      companion: entry.fields.every((name) => fields[name]?.companion === true),
    }));
  return {
    collection: meta.name,
    table: collectionTableName(meta.name),
    fields,
    compositeUniques,
    ...(translatable ? { translatable: true } : {}),
    ...(companion ? { companionTable: companionTableName(meta.name) } : {}),
  };
}

/**
 * Walks one field map in declaration order and adds each field's entry.
 * `logical` is the untruncated name derived tables under this scope compose from.
 * `home` is the owning scope's rendered phrase, `` collection `Posts` `` or `` block `Hero` ``.
 * A malformed `when` reads its home in the error.
 */
function addFieldEntries(
  into: Record<string, FieldQueryMeta>,
  fieldMap: Record<string, FieldInstance>,
  logical: string,
  home: string,
): void {
  for (const [name, instance] of Object.entries(fieldMap)) {
    into[name] = fieldEntry(name, instance, logical, home);
  }
}

/**
 * Builds one field's entry through the shared field-walk, recursing into composite subfields.
 * Options freeze here, once, so every pipeline invocation shares one readonly object.
 * A declared `when` parses into its node here too, so the pipeline reads one parsed condition.
 */
function fieldEntry(
  name: string,
  instance: FieldInstance,
  logical: string,
  home: string,
): FieldQueryMeta {
  const registered = useFields().get(instance.type);
  if (isUndefined(registered)) throw ohneError(`Unknown field type \`${instance.type}\``);
  const resolved = resolveFieldStorage(name, instance, registered.fieldType);
  const { fieldType, hint, kind } = resolved;
  const options = Object.freeze(resolved.options);

  const when = parseFieldWhen(options, name, home);
  const gate = isUndefined(when) ? {} : { when };
  const translatable = options.translatable === true;
  const flags = {
    ...(options.readable === false ? { readable: false as const } : {}),
    ...(options.writable === false ? { writable: false as const } : {}),
    ...(options.immutable === true ? { immutable: true as const } : {}),
  };

  if (kind === 'blocks') {
    return {
      kind,
      fieldType,
      options,
      nullable: false,
      table: derivedTableName(logical, name),
      allow: fieldAllow((hint as BlocksHint).allow, name, home),
      ...gate,
      ...flags,
      ...(translatable ? { localeScoped: true } : {}),
    };
  }

  if (kind === 'junction') {
    const { collection: target, inverse } = hint as JunctionHint;
    const scoped = isUndefined(inverse) ? translatable : ownerTranslatable(target, inverse);
    return {
      kind: 'records',
      fieldType,
      options,
      nullable: false,
      target,
      ...gate,
      ...flags,
      ...(scoped ? { localeScoped: true } : {}),
      ...(isUndefined(inverse)
        ? { table: derivedTableName(logical, name) }
        : { inverse: true, table: derivedTableName(target, inverse) }),
    };
  }

  if (kind === 'childOne' || kind === 'childMany') {
    const subfields: Record<string, FieldQueryMeta> = Object.assign(Object.create(null), {
      UUID: uuidEntry(),
    });
    addFieldEntries(subfields, (hint as ChildHint).subfields, `${logical}_${name}`, home);
    return {
      kind,
      fieldType,
      options,
      nullable: kind === 'childOne',
      table: derivedTableName(logical, name),
      subfields,
      ...gate,
      ...flags,
      ...(translatable ? { localeScoped: true } : {}),
    };
  }

  return {
    kind: kind === 'foreignKey' ? 'record' : 'column',
    fieldType,
    options,
    nullable: options.nullable,
    logicalType: fieldType.columnType as LogicalType,
    column: name,
    ...gate,
    ...flags,
    ...(fieldType.jsonList === true ? { jsonList: true as const } : {}),
    ...(translatable ? { companion: true } : {}),
    ...(kind === 'foreignKey' ? { target: (hint as ForeignKeyHint).collection } : {}),
  };
}

/**
 * Resolves a blocks field's allow list against the block registry, frozen for sharing.
 * The schema build already validated it, so a failure here means an unsynced or unregistered state.
 */
function fieldAllow(
  allow: readonly string[] | undefined,
  name: string,
  home: string,
): readonly string[] {
  const result = resolveAllowedBlocks(allow, useBlocks().keys());
  if (result.ok) return Object.freeze(result.allowed);
  if (result.reason === 'empty') {
    throw ohneError(`Field \`${name}\` on ${home} has no block types to hold`);
  }
  throw ohneError(`Field \`${name}\` on ${home} allows unknown block \`${result.block}\``);
}

/**
 * Whether the owning side of an inverse `records` relation is translatable.
 * An inverse field reads the owner's junction, so the owner's option decides its locale scoping.
 * Resolved straight from the registries - `queryMetadata` would recurse on a self-relation.
 */
function ownerTranslatable(target: string, ownerField: string): boolean {
  const owner = useCollections().get(target);
  const instance = owner?.collection.fields[ownerField];
  if (isUndefined(instance)) return false;
  const registered = useFields().get(instance.type);
  if (isUndefined(registered)) return false;
  const resolved = resolveFieldStorage(ownerField, instance, registered.fieldType);
  return resolved.options.translatable === true;
}

/**
 * Parses a field's `when` option into its condition node, or throws when the object is malformed.
 * Only the grammar is checked here; whether each path and operator fits the field is `validateWhen`'s job.
 */
function parseFieldWhen(
  options: Readonly<Record<string, unknown>>,
  name: string,
  home: string,
): ConditionNode | undefined {
  if (!hasKey(options, 'when')) return undefined;
  const result = parseCondition(options.when);
  if (result.ok) return result.node;
  const at = result.error.path === '' ? '' : ` at \`${result.error.path}\``;
  throw ohneError({
    title: `Invalid \`when\` condition on \`${name}\``,
    body: [
      `Field \`${name}\` on ${home} has a malformed \`when\` condition${at}.`,
      whenGrammarHint(result.error.code),
    ],
  });
}

/**
 * A one-line hint for a malformed `when`, keyed on the parse failure's category.
 */
function whenGrammarHint(code: ConditionError['code']): string {
  switch (code) {
    case 'unknownOperator':
      return 'The key is not a known operator.';
    case 'invalidValue':
      return 'An operator carries a value of the wrong kind; `isNull` takes only `true`.';
    case 'nullEquality':
      return '`null` is not a valid value - use `isNull` to test for it.';
    case 'tooDeep':
      return 'The condition nests too deeply.';
    case 'invalidShape':
      return 'A value or key does not fit the condition grammar.';
  }
}
