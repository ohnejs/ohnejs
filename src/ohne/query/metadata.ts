import type { CollectionMeta } from '../collections/use-collections.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { FieldType } from '../fields/define-field.ts';
import type { FieldInstance } from '../fields/field.ts';
import type { ChildHint, ForeignKeyHint, JunctionHint } from '../fields/storage-hint.ts';

import { isUndefined } from '../../utils/index.ts';
import { useCollections } from '../collections/use-collections.ts';
import { collectionTableName, derivedTableName } from '../database/naming/table-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveFieldStorage } from '../fields/resolve-field.ts';
import { useFields } from '../fields/use-fields.ts';

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
   * No built-in field type sets it yet; a list-shaped `json` type opts in when it lands.
   */
  jsonList?: true;

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
 * An unknown collection throws.
 *
 * @example
 * ```ts
 * queryMetadata('Posts')
 * // -> { collection: 'Posts', table: 'Posts', fields: { UUID: {...}, _updatedAt: {...}, ... } }
 * ```
 */
export function queryMetadata(collection: string): CollectionQueryMeta {
  const cached = cache.get(collection);
  if (!isUndefined(cached)) return cached;
  const meta = useCollections().get(collection);
  if (isUndefined(meta)) throw ohneError(`Unknown collection \`${collection}\``);
  const built = buildCollectionMeta(meta);
  cache.set(collection, built);
  return built;
}

/**
 * The `UUID` entry every collection and child scope leads with: identity-only, never null.
 */
function uuidEntry(): FieldQueryMeta {
  return { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true };
}

/**
 * Builds one collection's metadata: the system entries, then the declared fields in order.
 */
function buildCollectionMeta(meta: CollectionMeta): CollectionQueryMeta {
  const fields: Record<string, FieldQueryMeta> = {
    UUID: uuidEntry(),
    _updatedAt: { kind: 'column', nullable: false, logicalType: 'integer', column: '_updatedAt' },
  };
  addFieldEntries(fields, meta.collection.fields, meta.name);
  return { collection: meta.name, table: collectionTableName(meta.name), fields };
}

/**
 * Walks one field map in declaration order and adds each field's entry.
 * `logical` is the untruncated name derived tables under this scope compose from.
 */
function addFieldEntries(
  into: Record<string, FieldQueryMeta>,
  fieldMap: Record<string, FieldInstance>,
  logical: string,
): void {
  for (const [name, instance] of Object.entries(fieldMap)) {
    const entry = fieldEntry(name, instance, logical);
    if (!isUndefined(entry)) into[name] = entry;
  }
}

/**
 * Builds one field's entry through the shared field-walk, recursing into composite subfields.
 * Options freeze here, once, so every pipeline invocation shares one readonly object.
 */
function fieldEntry(
  name: string,
  instance: FieldInstance,
  logical: string,
): FieldQueryMeta | undefined {
  const registered = useFields().get(instance.type);
  if (isUndefined(registered)) throw ohneError(`Unknown field type \`${instance.type}\``);
  const resolved = resolveFieldStorage(name, instance, registered.fieldType);
  const { fieldType, hint, kind } = resolved;
  const options = Object.freeze(resolved.options);

  if (kind === 'blocks') return undefined;

  if (kind === 'junction') {
    const { collection, inverse } = hint as JunctionHint;
    return {
      kind: 'records',
      fieldType,
      options,
      nullable: false,
      target: collection,
      ...(isUndefined(inverse)
        ? { table: derivedTableName(logical, name) }
        : { inverse: true, table: derivedTableName(collection, inverse) }),
    };
  }

  if (kind === 'childOne' || kind === 'childMany') {
    const subfields: Record<string, FieldQueryMeta> = { UUID: uuidEntry() };
    addFieldEntries(subfields, (hint as ChildHint).subfields, `${logical}_${name}`);
    return {
      kind,
      fieldType,
      options,
      nullable: kind === 'childOne',
      table: derivedTableName(logical, name),
      subfields,
    };
  }

  return {
    kind: kind === 'foreignKey' ? 'record' : 'column',
    fieldType,
    options,
    nullable: options.nullable,
    logicalType: fieldType.columnType as LogicalType,
    column: name,
    ...(kind === 'foreignKey' ? { target: (hint as ForeignKeyHint).collection } : {}),
  };
}
