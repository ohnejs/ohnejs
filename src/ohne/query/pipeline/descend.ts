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
import { coerceColumn } from './preflight.ts';
import { defaultPath, isProvided, runTiers, validateContext, writeContext } from './run-field.ts';

/**
 * The field's full path from the record root, the prefix its refs and nested scopes carry.
 */
function fieldPath(name: string, ctx: ScopeContext): string {
  return ctx.path === '' ? name : prefixPath(ctx.path, name);
}

/**
 * Runs a composite field's own sanitizer and validator tiers over its provided value, in Phase B.
 *
 * Mirrors `finishScalar`'s tier run, so a composite validates and cleans exactly as a scalar does.
 * A type or instance own-message keys at the field; a validator's sub-path failures lift out prefixed.
 */
export async function runCompositeTiers(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<{ errors: FieldErrors } | { value: unknown }> {
  const wctx = writeContext(name, meta, input, ctx);
  const errors: FieldErrors = {};
  const vctx = validateContext(wctx, errors);
  const tiered = await runTiers(value, meta, wctx, vctx);
  if (tiered.error) return { errors: { [name]: tiered.error } };
  if (!isEmpty(errors)) return { errors: prefixErrors(name, errors) };
  return { value: tiered.value };
}

/**
 * Phase A for a `records`, `object`, `repeater`, or `blocks` field: default path, null gate, shape check.
 *
 * An absent field takes its empty default, except at the top level of an update, where it is skipped.
 * An explicit `undefined` counts as absent, exactly as `prepareScalar` reads it.
 * A nested composite item is always full, so its absent list or object subfield defaults even under an update.
 * A list rejects `null` - its empty value is `[]`; an `object` accepts `null`, which clears the child row.
 * A provided value is marked `provided`, so Phase B runs the field's own sanitizers and validators over it.
 * A default is trusted and unmarked: its tiers never run, so an absent or inactive list lands `[]` untiered.
 * A provided `object` or repeater also carries its coerced `snapshot`, the view a sibling `when` reads.
 * A `records` or `blocks` value stays raw: a gate can only test its membership, never walk it.
 */
export async function prepareComposite(
  name: string,
  meta: FieldQueryMeta,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<Prepared> {
  if (!isProvided(input, name)) {
    if (ctx.operation === 'update' && ctx.path === '') return { skip: true };
    if (!isUndefined(ctx.snapshot) && hasKey(ctx.snapshot, name)) {
      return { value: ctx.snapshot[name] };
    }
    return defaultPath(name, meta, writeContext(name, meta, input, ctx));
  }
  const value = input[name];
  if (meta.kind === 'childOne') {
    if (isNull(value)) return { value: null };
    if (!isObject(value)) return { errors: { [name]: 'validation.invalidValue' } };
    return { value, provided: true, snapshot: await fieldSnapshot(name, meta, value, ctx) };
  }
  if (isNull(value)) return { errors: { [name]: 'validation.notNullable' } };
  if (!isArray(value)) return { errors: { [name]: 'validation.invalidValue' } };
  const wellShaped = meta.kind === 'records' ? value.every(isString) : value.every(isObject);
  if (!wellShaped) return { errors: { [name]: 'validation.invalidValue' } };
  if (meta.kind !== 'childMany') return { value, provided: true };
  return { value, provided: true, snapshot: await fieldSnapshot(name, meta, value, ctx) };
}

/**
 * The coerced view of one provided composite value, reused from the enclosing snapshot or built fresh.
 */
async function fieldSnapshot(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  ctx: ScopeContext,
): Promise<unknown> {
  if (!isUndefined(ctx.snapshot) && hasKey(ctx.snapshot, name)) return ctx.snapshot[name];
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  const { snapshot: _outer, ...base } = ctx;
  const path = fieldPath(name, ctx);
  if (meta.kind === 'childOne') {
    return itemSnapshot(subfields, value as Record<string, unknown>, { ...base, path });
  }
  const items = value as Record<string, unknown>[];
  return Promise.all(
    items.map((item, index) =>
      itemSnapshot(subfields, item, { ...base, path: `${path}[${index}]` }),
    ),
  );
}

/**
 * The coerced, defaulted view of one composite item, the substrate a `when` resolves against.
 *
 * A present column subfield coerces toward its primitive; a `null` or a `record` value stays raw.
 * An absent subfield takes its resolved default's value, so a gate reads what phase B will store.
 * A nested `object` or repeater recurses; `records` and `blocks` stay raw, since no gate walks them.
 * Sanitizers and validators never run here - phase B still receives and checks the raw input.
 * A default that fails contributes no key, matching a phase-A error's absent value.
 */
async function itemSnapshot(
  subfields: Record<string, FieldQueryMeta>,
  item: Record<string, unknown>,
  ctx: ScopeContext,
): Promise<Record<string, unknown>> {
  const view: Record<string, unknown> = { ...item };
  for (const [name, sub] of Object.entries(subfields)) {
    if (isUndefined(sub.fieldType)) continue;
    if (!isProvided(item, name)) {
      const prepared = await defaultPath(name, sub, writeContext(name, sub, item, ctx));
      if ('value' in prepared) view[name] = prepared.value;
      continue;
    }
    const raw = item[name];
    if (sub.kind === 'column' && !isNull(raw)) {
      view[name] = coerceColumn(raw, sub.logicalType as LogicalType);
    } else if (
      (sub.kind === 'childOne' && isObject(raw)) ||
      (sub.kind === 'childMany' && isArray(raw) && raw.every(isObject))
    ) {
      view[name] = await fieldSnapshot(name, sub, raw, ctx);
    }
  }
  return view;
}

/**
 * Phase B for a `records`, `object`, `repeater`, or `blocks` field: the relation write, or the descent.
 *
 * A `records` list yields one relation write plus a reference per linked `UUID`.
 * A repeated `UUID` is rejected as `notUnique`: the junction's link is unique, so one create links once.
 * A composite recurses through `processScope` per item, its errors and refs re-pathed under the field.
 * A blocks item validates its envelope first, then descends its `fields` under the named block's scope.
 * On update a repeater or blocks item's `UUID` is lifted off, so the write step can correlate it.
 * A repeated item `UUID` is rejected as `notUnique` there: two items cannot keep one row.
 * A `null` object on update clears the existing child row instead of descending into it.
 * `snapshot` is the field's phase-A coerced view; each item descends carrying its slice.
 * An absent subfield then reuses the already-resolved default instead of resolving its callback again.
 */
export async function finishComposite(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  ctx: ScopeContext,
  processScope: ProcessScope,
  snapshot?: unknown,
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
      ...(isObject(snapshot) ? { snapshot: snapshot as Record<string, unknown> } : {}),
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
  const claimed = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const correlated = liftItemUUID(items[index], ctx.operation);
    if ('error' in correlated) {
      errors[`${name}[${index}].UUID`] = correlated.error;
      continue;
    }
    if (!isUndefined(correlated.uuid)) {
      if (claimed.has(correlated.uuid)) {
        errors[`${name}[${index}].UUID`] = 'validation.notUnique';
        continue;
      }
      claimed.add(correlated.uuid);
    }
    const itemView = isArray(snapshot) ? snapshot[index] : undefined;
    const result = await processScope(subfields, correlated.input, {
      ...ctx,
      path: `${path}[${index}]`,
      ...(isObject(itemView) ? { snapshot: itemView as Record<string, unknown> } : {}),
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
 * A repeated instance `UUID` is rejected as `notUnique`, exactly as a repeater item's is.
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
  const claimed = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const envelope = blockEnvelope(name, index, items[index], allow, ctx.operation);
    if ('errors' in envelope) {
      Object.assign(errors, envelope.errors);
      continue;
    }
    if (!isUndefined(envelope.uuid)) {
      if (claimed.has(envelope.uuid)) {
        errors[`${name}[${index}].UUID`] = 'validation.notUnique';
        continue;
      }
      claimed.add(envelope.uuid);
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
 * The `unknownBlock` failure as its `{ key, params }` message object.
 * The key lives in the framework's own catalog, resolved at the boundary, never in `KnownMessages`.
 * Its object is therefore not a `Message` member here; the cast bridges it.
 */
function unknownBlockMessage(block: unknown): Message {
  return { key: 'validation.unknownBlock', params: { block: String(block) } } as unknown as Message;
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
