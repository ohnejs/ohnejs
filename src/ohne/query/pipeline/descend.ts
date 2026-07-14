import type { LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';
import type {
  FieldOutput,
  Prepared,
  ProcessedScope,
  ProcessScope,
  ScopeContext,
  UniqueProbe,
} from './run-record.ts';

import {
  hasKey,
  isArray,
  isEmpty,
  isNull,
  isNullish,
  isObject,
  isString,
  uniqueArray,
} from '../../../utils/index.ts';
import { prefixErrors, prefixPath } from './prefix-errors.ts';
import { defaultPath, writeContext } from './run-field.ts';

/**
 * The field's full path from the record root, the prefix its refs and nested scopes carry.
 */
function fieldPath(name: string, ctx: ScopeContext): string {
  return ctx.path === '' ? name : prefixPath(ctx.path, name);
}

/**
 * Phase A for a `records`, `object`, or `repeater` field: the default path, the null gate, the shape check.
 *
 * An absent field on create takes its empty default; on update it is skipped.
 * A list rejects `null` - its empty value is `[]`; an `object` accepts `null`, which clears the child row.
 */
export async function prepareComposite(
  name: string,
  meta: FieldQueryMeta,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<Prepared> {
  if (!hasKey(input, name)) {
    if (ctx.operation === 'update') return { skip: true };
    return defaultPath(name, meta, writeContext(name, meta, input, ctx));
  }
  const value = input[name];
  if (meta.kind === 'childOne') {
    if (isNull(value)) return { value: null };
    return isObject(value) ? { value } : { errors: { [name]: 'validation.invalidValue' } };
  }
  if (isNull(value)) return { errors: { [name]: 'validation.notNullable' } };
  if (!isArray(value)) return { errors: { [name]: 'validation.invalidValue' } };
  const wellShaped = meta.kind === 'records' ? value.every(isString) : value.every(isObject);
  return wellShaped ? { value } : { errors: { [name]: 'validation.invalidValue' } };
}

/**
 * Phase B for a `records`, `object`, or `repeater` field: the relation write, or the child descent.
 *
 * A `records` list yields one relation write plus a reference per linked `UUID`.
 * A repeated `UUID` is rejected as `notUnique`: the junction's link is unique, so one create links once.
 * A composite recurses through `processScope` per item, its errors and refs re-pathed under the field.
 */
export async function finishComposite(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  ctx: ScopeContext,
  processScope: ProcessScope,
): Promise<FieldOutput> {
  const path = fieldPath(name, ctx);

  if (meta.kind === 'records') {
    const uuids = value as string[];
    if (uniqueArray(uuids).length !== uuids.length) {
      return { errors: { [name]: 'validation.notUnique' } };
    }
    const target = meta.target as string;
    return {
      relation: { meta, uuids },
      refs: uuids.map((uuid, index) => ({ path: `${path}[${index}]`, target, uuid })),
    };
  }

  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  if (meta.kind === 'childOne') {
    if (isNull(value)) return {};
    const result = await processScope(subfields, value as Record<string, unknown>, {
      ...ctx,
      path,
    });
    if (!result.ok) return { errors: prefixErrors(name, result.errors) };
    return {
      child: { meta, items: [result.scope] },
      refs: result.scope.refs,
      uniqueProbes: [
        ...tableWideProbes(meta, [result.scope], () => path),
        ...result.scope.uniqueProbes,
      ],
    };
  }

  const items = value as Record<string, unknown>[];
  const errors = {};
  const scopes = [];
  for (let index = 0; index < items.length; index++) {
    const result = await processScope(subfields, items[index], {
      ...ctx,
      path: `${path}[${index}]`,
    });
    if (result.ok) scopes.push(result.scope);
    else Object.assign(errors, prefixErrors(name, prefixErrors(`[${index}]`, result.errors)));
  }
  if (isEmpty(errors)) Object.assign(errors, duplicateSubfieldErrors(name, subfields, scopes));
  if (!isEmpty(errors)) return { errors };
  return {
    child: { meta, items: scopes },
    refs: scopes.flatMap((scope) => scope.refs),
    uniqueProbes: [
      ...tableWideProbes(meta, scopes, (index) => `${path}[${index}]`),
      ...scopes.flatMap((scope) => scope.uniqueProbes),
    ],
  };
}

/**
 * Rejects a repeated value on a `uniquePerParent` subfield within one item list, keyed at the item.
 * That constraint scopes to one parent, and on create the parent is fresh, so a same-list clash is all of it.
 * A table-wide `unique` subfield goes through the child-uniqueness precheck instead, since it spans parents.
 */
function duplicateSubfieldErrors(
  field: string,
  subfields: Record<string, FieldQueryMeta>,
  scopes: ProcessedScope[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const [name, meta] of Object.entries(subfields)) {
    if (meta.options?.uniquePerParent !== true) continue;
    const column = meta.column as string;
    const seen = new Set<unknown>();
    for (let index = 0; index < scopes.length; index++) {
      const value = scopes[index].columns[column];
      if (isNullish(value)) continue;
      if (seen.has(value)) errors[`${field}[${index}].${name}`] = 'validation.notUnique';
      else seen.add(value);
    }
  }
  return errors;
}

/**
 * Gathers a probe per table-wide `unique` subfield value, so the precheck can prove each one free.
 * A `null` never collides, so it is skipped; a `uniquePerParent` subfield stays with the in-memory check.
 * The `basePath` callback yields each item's dot-path, so the probe points at the exact field.
 */
function tableWideProbes(
  meta: FieldQueryMeta,
  scopes: ProcessedScope[],
  basePath: (index: number) => string,
): UniqueProbe[] {
  const table = meta.table as string;
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  const probes: UniqueProbe[] = [];
  for (const [name, sub] of Object.entries(subfields)) {
    if (sub.options?.unique !== true || sub.options?.uniquePerParent === true) continue;
    const column = sub.column as string;
    const logicalType = sub.logicalType as LogicalType;
    for (let index = 0; index < scopes.length; index++) {
      const value = scopes[index].columns[column];
      if (isNullish(value)) continue;
      probes.push({ table, column, logicalType, value, path: prefixPath(basePath(index), name) });
    }
  }
  return probes;
}
