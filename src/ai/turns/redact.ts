import type { CollectionQueryMeta, ConditionInput, FieldQueryMeta, QueryScope } from 'ohnejs';

import { admittedUUIDs, queryMetadata, resolveGuards } from 'ohnejs';
import {
  hasKey,
  isArray,
  isEmpty,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  parseBytes,
} from 'ohnejs/utils';

import { readScope } from '../../base/collections-api/gate.ts';
import { useAIConfig } from '../config.ts';

/**
 * Records as a receipt carries them, cut to what the model may see.
 */
export interface RedactedRecords {
  /**
   * The records, each its `UUID`, the system fields it carries, and the opened fields the person may read.
   * A record the person's read would not return is its `UUID` alone.
   */
  records: Record<string, unknown>[];

  /**
   * Set when the list was cut at `ai.limits.resultSize`, so the model knows it is short.
   */
  truncated?: true;
}

/**
 * A reported record: a plain object naming its `UUID`.
 */
type Row = { UUID: string; [key: string]: unknown };

interface Opened {
  meta: CollectionQueryMeta;
  fields: string[];
  where: ConditionInput | undefined;
}

/**
 * The fields every record carries, which a model reads whatever `ai.data` opens.
 */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set(['UUID', '_updatedAt', '_translations']);

/**
 * Whether record values may reach the `ai.models` entry `model`.
 * Every model's may, unless the entry sets `data: false`.
 */
export function modelSeesValues(model: string): boolean {
  return useAIConfig().models[model]?.data !== false;
}

/**
 * The fields of `collection` whose values may leave under the person's read `scope`, in declared order.
 * They are the fields `ai.data` opens, among those the scope selects and any read returns.
 * Empty for a collection `ai.data` leaves out, and always for `Users`.
 */
export function openedFields(collection: string, scope: QueryScope): string[] {
  const opened = useAIConfig().data[collection];
  if (isUndefined(opened) || collection === 'Users') return [];
  const { fields } = queryMetadata(collection);
  const selected = isUndefined(scope.select) ? null : new Set(scope.select);
  return Object.keys(fields).filter(
    (name) =>
      !SYSTEM_FIELDS.has(name) &&
      fields[name].readable !== false &&
      (isNull(selected) || selected.has(name)) &&
      (opened === true || opened.includes(name)),
  );
}

/**
 * Redacts the records a read or write of `collection` answered, read at `locale`, to what the model may see.
 * Each keeps its `UUID`, the system fields, and the opened fields; a `readable: false` field never leaves.
 * A record the person's read `where` does not admit collapses to its `UUID`.
 * A populated relation recurses with the target's own rules, down to the guards' `maxPopulateDepth`.
 * One into a collection that may not leave, or nested deeper than any read populates, is its `UUID` again.
 * The list is cut at `ai.limits.resultSize`, whole records at a time, and marked `truncated`.
 * Nothing leaves, `undefined`, when the collection is not opened or the person cannot read it.
 * An entry that is no record is dropped.
 * Valid only within a request.
 */
export async function redactRecords(
  records: unknown[],
  collection: string,
  locale: string | null,
): Promise<RedactedRecords | undefined> {
  const depth = resolveGuards().maxPopulateDepth;
  const redacted = await redactList(records.filter(isRow), collection, locale, depth);
  if (isNull(redacted)) return undefined;
  return cut(redacted, parseBytes(useAIConfig().limits.resultSize));
}

/**
 * Redacts one list of `collection` rows, or answers `null` when nothing of the collection may leave.
 * `depth` is how many more relation levels may stay populated.
 */
async function redactList(
  rows: Row[],
  collection: string,
  locale: string | null,
  depth: number,
): Promise<Row[] | null> {
  const opened = await openedIn(collection);
  if (isNull(opened)) return null;
  const { meta, fields, where } = opened;
  const admitted = isUndefined(where)
    ? null
    : await admittedUUIDs(
        collection,
        meta,
        where,
        rows.map((row) => row.UUID),
        locale,
      );
  const kept = rows.map((row) =>
    isNull(admitted) || admitted.has(row.UUID) ? keep(row, fields, meta) : { UUID: row.UUID },
  );
  for (const name of fields) {
    const field = meta.fields[name];
    if (field.kind !== 'record' && field.kind !== 'records') continue;
    const populated = kept.flatMap((row) => populatedIn(row[name]));
    if (isEmpty(populated)) continue;
    const inner =
      depth === 0 ? null : await redactList(populated, field.target as string, locale, depth - 1);
    let index = 0;
    for (const row of kept) {
      if (!hasKey(row, name)) continue;
      row[name] = isNull(inner)
        ? unpopulated(row[name])
        : repopulated(row[name], () => inner[index++]);
    }
  }
  return kept;
}

/**
 * What may leave of `collection` for the person: its metadata, the opened fields, and the read `where`.
 * `null` when the person cannot read it or no field is opened.
 */
async function openedIn(collection: string): Promise<Opened | null> {
  const scope = await readScope(collection);
  if (scope === false) return null;
  const fields = openedFields(collection, scope);
  if (isEmpty(fields)) return null;
  return { meta: queryMetadata(collection), fields, where: scope.where };
}

/**
 * The row cut to its `UUID`, the system fields it carries, and `fields`, hidden subfields stripped.
 */
function keep(row: Row, fields: readonly string[], meta: CollectionQueryMeta): Row {
  const kept: Row = { UUID: row.UUID };
  for (const name of ['_updatedAt', '_translations', ...fields]) {
    if (!hasKey(row, name)) continue;
    const subfields = meta.fields[name]?.subfields;
    kept[name] = isUndefined(subfields) ? row[name] : stripHidden(row[name], subfields);
  }
  return kept;
}

/**
 * A composite value with only the declared, readable subfields, at every depth.
 */
function stripHidden(value: unknown, fields: Record<string, FieldQueryMeta>): unknown {
  if (isArray(value)) return value.map((item) => stripHidden(item, fields));
  if (!isPlainObject(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.readable === false || !hasKey(value, name)) continue;
    kept[name] = isUndefined(field.subfields)
      ? value[name]
      : stripHidden(value[name], field.subfields);
  }
  return kept;
}

/**
 * The populated records among a relation's value, in order; none for a value of ids.
 */
function populatedIn(value: unknown): Row[] {
  if (isArray(value)) return value.filter(isRow);
  return isRow(value) ? [value] : [];
}

/**
 * A relation's value with every populated record swapped back for its `UUID`.
 */
function unpopulated(value: unknown): unknown {
  if (isArray(value)) return value.map(unpopulated);
  return isRow(value) ? value.UUID : value;
}

/**
 * A relation's value with every populated record swapped for the `next` redacted one, in order.
 */
function repopulated(value: unknown, next: () => Row): unknown {
  if (isArray(value)) return value.map((item) => (isRow(item) ? next() : item));
  return isRow(value) ? next() : value;
}

/**
 * The records that fit in `max` bytes of JSON, whole records at a time, marked when any were dropped.
 */
function cut(records: Row[], max: number): RedactedRecords {
  let size = 2;
  for (const [index, record] of records.entries()) {
    size += Buffer.byteLength(JSON.stringify(record)) + (index === 0 ? 0 : 1);
    if (size > max) return { records: records.slice(0, index), truncated: true };
  }
  return { records };
}

/**
 * Whether `value` is a record: a plain object naming its `UUID`.
 */
function isRow(value: unknown): value is Row {
  return isPlainObject(value) && isString(value.UUID);
}
