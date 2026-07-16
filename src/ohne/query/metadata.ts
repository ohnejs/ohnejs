import type { ConditionError, ConditionNode } from '../../utils/index.ts';
import type { CollectionMeta } from '../collections/use-collections.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type { ChildHint, ForeignKeyHint, JunctionHint } from '../fields/storage-hint.ts';

import { hasKey, isUndefined, parseCondition } from '../../utils/index.ts';
import { useCollections } from '../collections/use-collections.ts';
import {
  collectionTableName,
  companionTableName,
  derivedTableName,
} from '../database/naming/table-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveFieldStorage } from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';
import { validateWhen } from './validate-when.ts';

/**
 * The query-facing shape of one field: where its value lives and how a condition may address it.
 * Column kinds carry their column and logical type.
 * Relation kinds carry their target; derived kinds their table.
 */
export interface FieldQueryMeta {
  /**
   * How the field stores and reads.
   * A plain column, a `record` reference, a `records` relation, or a child table.
   * `childOne` holds one child row per parent, `childMany` many.
   */
  kind: 'column' | 'record' | 'records' | 'childOne' | 'childMany';

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
   * `childOne` is always nullable; `records` and `childMany` never are.
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
   * The derived table the values live in: a `records` junction, or a composite's child table.
   */
  table?: string;

  /**
   * The child table's own fields, its item `UUID` included; child kinds only.
   */
  subfields?: Record<string, FieldQueryMeta>;

  /**
   * The field's parsed `when` condition, present when the instance declares one.
   * Its paths resolve in the field's own scope, so the pipeline reads the same node every write.
   */
  when?: ConditionNode;
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
   * Every addressable field in order: `UUID`, `_updatedAt`, then the declared fields as authored.
   */
  fields: Record<string, FieldQueryMeta>;

  /**
   * Marks a collection with at least one translatable field - the collections `.locale()` accepts.
   */
  translatable?: true;

  /**
   * The `<Owner>__translations` table holding the translatable columns, one row per
   * (record, locale); present when at least one translatable field carries a column.
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
 * Builds and caches every collection's query metadata, validating each declared `when` in the process.
 *
 * Run at boot so a malformed or misaddressed `when` fails before the server serves, not on a first write.
 * The build is memoized, so this warms the cache every later read and write then reuses.
 */
export function warmQueryMetadata(): void {
  for (const meta of Object.values(useCollections().all())) queryMetadata(meta.name);
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
 */
function buildCollectionMeta(meta: CollectionMeta): CollectionQueryMeta {
  const fields: Record<string, FieldQueryMeta> = Object.assign(Object.create(null), {
    UUID: uuidEntry(),
    _updatedAt: { kind: 'column', nullable: false, logicalType: 'integer', column: '_updatedAt' },
  });
  addFieldEntries(fields, meta.collection.fields, meta.name, meta.name);
  const entries = Object.values(fields);
  const companion = entries.some((field) => field.companion === true);
  const translatable =
    companion || entries.some((field) => field.localeScoped === true && field.inverse !== true);
  return {
    collection: meta.name,
    table: collectionTableName(meta.name),
    fields,
    ...(translatable ? { translatable: true } : {}),
    ...(companion ? { companionTable: companionTableName(meta.name) } : {}),
  };
}

/**
 * Walks one field map in declaration order and adds each field's entry.
 * `logical` is the untruncated name derived tables under this scope compose from.
 * `collection` names the owning collection, so a malformed `when` reads its home in the error.
 */
function addFieldEntries(
  into: Record<string, FieldQueryMeta>,
  fieldMap: Record<string, FieldInstance>,
  logical: string,
  collection: string,
): void {
  for (const [name, instance] of Object.entries(fieldMap)) {
    const entry = fieldEntry(name, instance, logical, collection);
    if (!isUndefined(entry)) into[name] = entry;
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
  collection: string,
): FieldQueryMeta | undefined {
  const registered = useFields().get(instance.type);
  if (isUndefined(registered)) throw ohneError(`Unknown field type \`${instance.type}\``);
  const resolved = resolveFieldStorage(name, instance, registered.fieldType);
  const { fieldType, hint, kind } = resolved;
  const options = Object.freeze(resolved.options);

  if (kind === 'blocks') return undefined;

  const when = parseFieldWhen(options, name, collection);
  const gate = isUndefined(when) ? {} : { when };
  const translatable = options.translatable === true;

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
    addFieldEntries(subfields, (hint as ChildHint).subfields, `${logical}_${name}`, collection);
    return {
      kind,
      fieldType,
      options,
      nullable: kind === 'childOne',
      table: derivedTableName(logical, name),
      subfields,
      ...gate,
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
    ...(translatable ? { companion: true } : {}),
    ...(kind === 'foreignKey' ? { target: (hint as ForeignKeyHint).collection } : {}),
  };
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
  collection: string,
): ConditionNode | undefined {
  if (!hasKey(options, 'when')) return undefined;
  const result = parseCondition(options.when);
  if (result.ok) return result.node;
  const at = result.error.path === '' ? '' : ` at \`${result.error.path}\``;
  throw ohneError({
    title: `Invalid \`when\` condition on \`${name}\``,
    body: [
      `Field \`${name}\` on collection \`${collection}\` has a malformed \`when\` condition${at}.`,
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
