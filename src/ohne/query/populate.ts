import type { PopulateNode } from './ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from './metadata.ts';
import type {
  PopulateBuild,
  PopulateSpec,
  PopulateSubQuery,
  UntypedPopulateBuilder,
} from './untyped.ts';

import {
  isFunction,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  toArray,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { queryMetadata } from './metadata.ts';
import { unknownFieldError } from './validate-condition.ts';

/**
 * Accumulates `populate` arguments onto a builder's node list, validating each entry as it lands.
 *
 * Every call form lands here: bare names, spec objects, and the `(field, callback)` pair.
 * Validation hops `queryMetadata(target)` per level.
 * An unknown field, a non-relation, or an unknown subselect name throws at the call, however deep.
 * A bare repeat of a bare node dedups silently; any repeat involving a spec throws.
 */
export function addPopulateEntries(
  nodes: PopulateNode[],
  args: readonly (string | PopulateSpec | PopulateBuild)[],
  meta: CollectionQueryMeta,
): void {
  if (args.length === 2 && isString(args[0]) && isFunction(args[1])) {
    insertNode(nodes, callbackNode(args[0], args[1] as PopulateBuild, meta));
    return;
  }
  for (const entry of args) {
    if (isString(entry)) {
      relationField(entry, meta);
      insertNode(nodes, { field: entry, select: null, children: [] });
      continue;
    }
    if (isPlainObject(entry)) {
      for (const [field, spec] of Object.entries(entry)) {
        insertNode(nodes, specNode(field, spec, meta));
      }
      continue;
    }
    throw ohneError({
      title: 'Invalid `populate` entry',
      body: ['An entry is a field name, a spec object, or one `(field, callback)` pair.'],
    });
  }
}

/**
 * Resolves a populate name to its relation metadata, refusing unknown and non-relation fields.
 */
function relationField(field: string, meta: CollectionQueryMeta): FieldQueryMeta {
  const entry = meta.fields[field];
  if (isUndefined(entry)) throw unknownFieldError(field, meta);
  if (entry.kind !== 'record' && entry.kind !== 'records') {
    throw ohneError({
      title: `Cannot populate \`${field}\``,
      body: [
        `Field \`${field}\` on collection \`${meta.collection}\` is not a relation; only \`record\` and \`records\` fields populate.`,
      ],
    });
  }
  return entry;
}

/**
 * Builds one node from a spec object's entry, validating its subselect and descending its populates.
 */
function specNode(field: string, spec: unknown, meta: CollectionQueryMeta): PopulateNode {
  const entry = relationField(field, meta);
  if (!isPlainObject(spec)) {
    throw ohneError({
      title: `Invalid populate spec for \`${field}\``,
      body: ['A spec is an object carrying `select` and `populate` alone.'],
    });
  }
  const { select: named, populate: descend } = spec as PopulateSubQuery;
  const target = queryMetadata(entry.target as string);
  const select = isUndefined(named) ? null : subselect([...toArray(named)], field, target);
  const children: PopulateNode[] = [];
  if (!isUndefined(descend)) addPopulateEntries(children, toArray(descend), target);
  return { field, select, children };
}

/**
 * Runs one populate callback over a sub-builder scoped to the relation's target and takes its node.
 */
function callbackNode(
  field: string,
  build: PopulateBuild,
  meta: CollectionQueryMeta,
): PopulateNode {
  const entry = relationField(field, meta);
  const sub = new PopulateSubBuilder(queryMetadata(entry.target as string));
  build(sub);
  return sub.toNode(field);
}

/**
 * Validates one node's subselect against the target's fields, refusing an empty or unknown name.
 */
function subselect(fields: string[], field: string, target: CollectionQueryMeta): string[] {
  if (fields.length === 0) throw emptySubselectError(field, target);
  for (const name of fields) {
    if (isUndefined(target.fields[name])) throw unknownFieldError(name, target);
  }
  return fields;
}

/**
 * An empty populate subselect, mirroring the wire's `emptySelect`: zero fields is a mistake.
 */
function emptySubselectError(
  field: string,
  target: CollectionQueryMeta,
): ReturnType<typeof ohneError> {
  return ohneError({
    title: `Empty populate subselect on \`${field}\``,
    body: [
      `Name at least one \`${target.collection}\` field, or drop \`select\` to read the whole record.`,
    ],
  });
}

/**
 * Adds one node at its level, deduping a bare repeat of a bare node and refusing every other repeat.
 * Two specs for one field would race the hydration, and the result type could not name both shapes.
 */
function insertNode(nodes: PopulateNode[], node: PopulateNode): void {
  const existing = nodes.find((candidate) => candidate.field === node.field);
  if (isUndefined(existing)) {
    nodes.push(node);
    return;
  }
  if (isBare(existing) && isBare(node)) return;
  throw ohneError({
    title: `Duplicate populate on \`${node.field}\``,
    body: [
      `Field \`${node.field}\` is already populated at this level.`,
      'Merge the two entries into one spec.',
    ],
  });
}

/**
 * Whether a node hydrates the whole record with no descent - the shape a bare name inserts.
 */
function isBare(node: PopulateNode): boolean {
  return isNull(node.select) && node.children.length === 0;
}

/**
 * The runtime sub-builder a populate callback drives: it accumulates one node's subselect and children.
 * Both methods validate against the target's metadata immediately, so a bad name throws at its call.
 */
class PopulateSubBuilder implements UntypedPopulateBuilder {
  private selected: string[] | null = null;
  private readonly children: PopulateNode[] = [];
  private readonly meta: CollectionQueryMeta;

  constructor(meta: CollectionQueryMeta) {
    this.meta = meta;
  }

  select(...fields: string[]): this {
    for (const field of fields) {
      if (isUndefined(this.meta.fields[field])) throw unknownFieldError(field, this.meta);
    }
    this.selected = [...(this.selected ?? []), ...fields];
    return this;
  }

  populate(...entries: (string | PopulateSpec)[]): this;
  populate(field: string, build: PopulateBuild): this;
  populate(...args: (string | PopulateSpec | PopulateBuild)[]): this {
    addPopulateEntries(this.children, args, this.meta);
    return this;
  }

  /**
   * The accumulated node; an explicit subselect that named zero fields refuses here, after the callback.
   */
  toNode(field: string): PopulateNode {
    if (!isNull(this.selected) && this.selected.length === 0) {
      throw emptySubselectError(field, this.meta);
    }
    return { field, select: this.selected, children: this.children };
  }
}
