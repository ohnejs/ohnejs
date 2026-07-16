import type { LogicalType } from '../../database/dialect.ts';
import type { Message } from '../../messages/known-messages.ts';
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
  isUndefined,
  uniqueArray,
} from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';
import { prefixErrors, prefixPath } from './prefix-errors.ts';
import { defaultPath, writeContext } from './run-field.ts';

/**
 * The field's full path from the record root, the prefix its refs and nested scopes carry.
 */
function fieldPath(name: string, ctx: ScopeContext): string {
  return ctx.path === '' ? name : prefixPath(ctx.path, name);
}

/**
 * Phase A for a `records`, `object`, `repeater`, or `blocks` field: default path, null gate, shape check.
 *
 * An absent field takes its empty default, except at the top level of an update, where it is skipped.
 * A nested composite item is always full, so its absent list or object subfield defaults even under an update.
 * A list rejects `null` - its empty value is `[]`; an `object` accepts `null`, which clears the child row.
 * A provided empty list is rejected when the field's `allowEmpty` option is `false`.
 * The default path bypasses that check: defaults are trusted, so an absent or inactive list lands `[]`.
 */
export async function prepareComposite(
  name: string,
  meta: FieldQueryMeta,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<Prepared> {
  if (!hasKey(input, name)) {
    if (ctx.operation === 'update' && ctx.path === '') return { skip: true };
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
  if (!wellShaped) return { errors: { [name]: 'validation.invalidValue' } };
  if (value.length === 0 && meta.options?.allowEmpty === false) {
    return { errors: { [name]: 'validation.emptyValue' } };
  }
  return { value };
}

/**
 * Phase B for a `records`, `object`, `repeater`, or `blocks` field: the relation write, or the descent.
 *
 * A `records` list yields one relation write plus a reference per linked `UUID`.
 * A repeated `UUID` is rejected as `notUnique`: the junction's link is unique, so one create links once.
 * A composite recurses through `processScope` per item, its errors and refs re-pathed under the field.
 * A blocks item validates its envelope first, then descends its `fields` under the named block's scope.
 * On update a repeater or blocks item's `UUID` is lifted off, so the write step can correlate it.
 * A `null` object on update clears the existing child row instead of descending into it.
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

  if (meta.kind === 'blocks') {
    return finishBlocks(name, meta, value as Record<string, unknown>[], path, ctx, processScope);
  }

  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  if (meta.kind === 'childOne') {
    if (isNull(value))
      return ctx.operation === 'update' ? { child: { meta, path, items: [] } } : {};
    const result = await processScope(subfields, value as Record<string, unknown>, {
      ...ctx,
      path,
    });
    if (!result.ok) return { errors: prefixErrors(name, result.errors) };
    return {
      child: { meta, path, items: [result.scope] },
      refs: result.scope.refs,
      uniqueProbes: [
        ...tableWideProbes(meta.table as string, subfields, [result.scope], () => path),
        ...result.scope.uniqueProbes,
      ],
    };
  }

  const items = value as Record<string, unknown>[];
  const errors: FieldErrors = {};
  const scopes: ProcessedScope[] = [];
  for (let index = 0; index < items.length; index++) {
    const correlated = liftItemUUID(items[index], ctx.operation);
    if ('error' in correlated) {
      errors[`${name}[${index}].UUID`] = correlated.error;
      continue;
    }
    const result = await processScope(subfields, correlated.input, {
      ...ctx,
      path: `${path}[${index}]`,
    });
    if (!result.ok) {
      Object.assign(errors, prefixErrors(name, prefixErrors(`[${index}]`, result.errors)));
      continue;
    }
    if (!isUndefined(correlated.uuid)) result.scope.itemUUID = correlated.uuid;
    scopes.push(result.scope);
  }
  if (isEmpty(errors)) Object.assign(errors, duplicateSubfieldErrors(name, subfields, scopes));
  if (!isEmpty(errors)) return { errors };
  return {
    child: { meta, path, items: scopes },
    refs: scopes.flatMap((scope) => scope.refs),
    uniqueProbes: [
      ...tableWideProbes(meta.table as string, subfields, scopes, (index) => `${path}[${index}]`),
      ...scopes.flatMap((scope) => scope.uniqueProbes),
    ],
  };
}

/**
 * Phase B for a `blocks` field: per item, the envelope gate, then the descent into the named block.
 *
 * Each item's envelope is closed - `block`, `fields`, and on update `UUID` - and validated first.
 * A valid item descends `processScope` over the block's own fields, errors under `<field>[<i>].fields`.
 * Its scope is tagged with the block type for the write step.
 * Unique subfield probes aim at the block's shared per-type table, never the field's wrapper.
 */
async function finishBlocks(
  name: string,
  meta: FieldQueryMeta,
  items: Record<string, unknown>[],
  path: string,
  ctx: ScopeContext,
  processScope: ProcessScope,
): Promise<FieldOutput> {
  const allow = meta.allow as readonly string[];
  const errors: FieldErrors = {};
  const scopes: ProcessedScope[] = [];
  const probes: UniqueProbe[] = [];
  for (let index = 0; index < items.length; index++) {
    const envelope = blockEnvelope(name, index, items[index], allow, ctx.operation);
    if ('errors' in envelope) {
      Object.assign(errors, envelope.errors);
      continue;
    }
    const blockMeta = blockQueryMetadata(envelope.block);
    const itemPath = `${path}[${index}].fields`;
    const result = await processScope(blockMeta.fields, envelope.fields, {
      ...ctx,
      path: itemPath,
    });
    if (!result.ok) {
      Object.assign(errors, prefixErrors(`${name}[${index}].fields`, result.errors));
      continue;
    }
    result.scope.blockType = envelope.block;
    if (!isUndefined(envelope.uuid)) result.scope.itemUUID = envelope.uuid;
    probes.push(
      ...tableWideProbes(blockMeta.table, blockMeta.fields, [result.scope], () => itemPath),
    );
    scopes.push(result.scope);
  }
  if (!isEmpty(errors)) return { errors };
  return {
    child: { meta, path, items: scopes },
    refs: scopes.flatMap((scope) => scope.refs),
    uniqueProbes: [...probes, ...scopes.flatMap((scope) => scope.uniqueProbes)],
  };
}

/**
 * Validates one blocks item's envelope: closed keys, a known allowed `block`, an object `fields`.
 *
 * On update a string `UUID` lifts out for correlation, exactly as a repeater item's does.
 * On create `UUID` is an unknown field - a create item carries none.
 * Every failure keys at its exact path under `<field>[<index>]`, relative to the enclosing scope.
 */
function blockEnvelope(
  field: string,
  index: number,
  item: Record<string, unknown>,
  allow: readonly string[],
  operation: ScopeContext['operation'],
): { block: string; fields: Record<string, unknown>; uuid?: string } | { errors: FieldErrors } {
  const itemPath = `${field}[${index}]`;
  const errors: FieldErrors = {};
  const known = new Set(operation === 'update' ? ['block', 'fields', 'UUID'] : ['block', 'fields']);
  for (const key of Object.keys(item)) {
    if (!known.has(key)) errors[`${itemPath}.${key}`] = 'validation.unknownField';
  }
  if (!hasKey(item, 'block')) errors[`${itemPath}.block`] = 'validation.required';
  else if (!isString(item.block) || !allow.includes(item.block)) {
    errors[`${itemPath}.block`] = unknownBlockMessage(item.block);
  }
  if (!hasKey(item, 'fields')) errors[`${itemPath}.fields`] = 'validation.required';
  else if (!isObject(item.fields)) errors[`${itemPath}.fields`] = 'validation.invalidValue';
  let uuid: string | undefined;
  if (operation === 'update' && hasKey(item, 'UUID')) {
    if (isString(item.UUID)) uuid = item.UUID;
    else errors[`${itemPath}.UUID`] = 'validation.invalidValue';
  }
  if (!isEmpty(errors)) return { errors };
  return {
    block: item.block as string,
    fields: item.fields as Record<string, unknown>,
    ...(isUndefined(uuid) ? {} : { uuid }),
  };
}

/**
 * The `unknownBlock` failure as its `[key, params]` message tuple.
 * Core compiles with `KnownMessages` empty, where `Message` has no tuple member.
 * The tuple therefore passes through `unknown`; the boundary resolves it like any other.
 */
function unknownBlockMessage(block: unknown): Message {
  return ['validation.unknownBlock', { block: String(block) }] as unknown as Message;
}

/**
 * Lifts a repeater item's `UUID` off for correlation on update, leaving the rest to process as a full item.
 * On create the `UUID` stays in, so `processScope` rejects it as an unknown field - a create item carries none.
 * A present-but-non-string `UUID` is an invalid value.
 */
function liftItemUUID(
  item: Record<string, unknown>,
  operation: ScopeContext['operation'],
): { input: Record<string, unknown>; uuid?: string } | { error: 'validation.invalidValue' } {
  if (operation !== 'update' || !hasKey(item, 'UUID')) return { input: item };
  const uuid = item.UUID;
  if (!isString(uuid)) return { error: 'validation.invalidValue' };
  const { UUID: _lifted, ...input } = item;
  return { input, uuid };
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
 * `table` is where the values land: a composite's child table, or a block's shared per-type table.
 */
function tableWideProbes(
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  scopes: ProcessedScope[],
  basePath: (index: number) => string,
): UniqueProbe[] {
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
