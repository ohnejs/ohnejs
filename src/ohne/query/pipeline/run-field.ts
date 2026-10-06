import type { CollectionName } from '../../collections/known-collections.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type {
  FieldSanitizer,
  FieldValidateContext,
  FieldValidator,
  FieldWriteContext,
} from '../../fields/context.ts';
import type { ValueOptions } from '../../fields/field.ts';
import type { Message } from '../../messages/known-messages.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';
import type { FieldOutput, Prepared, ScopeContext } from './run-record.ts';

import {
  hasKey,
  isArray,
  isEmpty,
  isFunction,
  isNull,
  isObject,
  isString,
  isUndefined,
} from '../../../utils/index.ts';
import { forbidsEmpty } from '../../fields/forbids-empty.ts';
import { isListField } from '../list-field.ts';
import { prefixErrors, prefixPath } from './prefix-errors.ts';
import { coerceColumn, isValidColumn } from './preflight.ts';

/**
 * Builds the write context a field's `defaultValue`, sanitizers, and serialize hook receive.
 */
export function writeContext(
  name: string,
  meta: FieldQueryMeta,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): FieldWriteContext {
  return {
    name,
    path: ctx.path === '' ? name : prefixPath(ctx.path, name),
    options: (meta.options ?? {}) as FieldWriteContext['options'],
    collection: ctx.collection as CollectionName,
    operation: ctx.operation,
    input,
    tx: ctx.tx,
    reachable: ctx.reachable,
  };
}

/**
 * Extends a write context with a fresh error slice, so a field's validators never share a map.
 */
export function validateContext(
  base: FieldWriteContext,
  errors: FieldErrors,
): FieldValidateContext {
  return { ...base, errors };
}

/**
 * Resolves a default source into its value, calling it when it is a callback.
 */
async function resolveDefaultValue(source: unknown, ctx: FieldWriteContext): Promise<unknown> {
  return isFunction<(ctx: FieldWriteContext) => unknown>(source) ? source(ctx) : source;
}

/**
 * Whether the input explicitly provides a field: the key present and its value not `undefined`.
 * Explicit `undefined` reads as absent - a create defaults the field, an update skips it.
 * This matches how `resolveFieldOptions` treats an explicit `default: undefined`.
 */
export function isProvided(input: Readonly<Record<string, unknown>>, name: string): boolean {
  return hasKey(input, name) && !isUndefined(input[name]);
}

/**
 * Whether a declared default holds the shape its field stores, the gate a provided value also passes.
 * A scalar's base type is checked in phase B, so only a composite or relation list is checked here.
 */
function isDefaultShaped(meta: FieldQueryMeta, value: unknown): boolean {
  if (meta.kind === 'column' || meta.kind === 'record') return true;
  if (meta.kind === 'childOne') return isNull(value) || isObject(value);
  if (!isArray(value)) return false;
  return meta.kind === 'records' ? value.every(isString) : value.every(isObject);
}

/**
 * An inactive field's fallback as phase B takes it, `trusted` when it is the list's own empty `[]`.
 *
 * An inactive field holds no value, and a list has no `null`, so its `[]` lands without running the tiers.
 * A declared `default` stays a value like any other, empty or not.
 */
function inactiveValue(meta: FieldQueryMeta, value: unknown): Prepared {
  const declared = !isUndefined(meta.options) && hasKey(meta.options, 'default');
  return !declared && isArray(value) && isEmpty(value) ? { value, trusted: true } : { value };
}

/**
 * An omitted field's inactive fallback, taken from what phase A already resolved.
 *
 * A landed default is kept, so its callback never runs twice.
 * A list that failed `required` lands its own `[]` instead: `min` binds it only while it is active.
 * Any other failure stands, since a declared `default` fails the same way inactive.
 */
export function inactiveAbsent(meta: FieldQueryMeta, prepared: Prepared): Prepared {
  if ('value' in prepared) return inactiveValue(meta, prepared.value);
  const declared = !isUndefined(meta.options) && hasKey(meta.options, 'default');
  return isListField(meta) && !declared ? { value: [], trusted: true } : prepared;
}

/**
 * The default path, keyed on the field's storage kind.
 *
 * An instance `default` wins; then the kind's empty value; then a column's type `defaultValue`.
 * A declared composite or list default of the wrong shape is rejected as `invalidValue`.
 * A list that `forbidsEmpty` has no empty value, so its `[]` is skipped and the field is `required`.
 * `inactive` resolves a gated field's fallback instead: a list that has nothing else lands its `[]`.
 * A non-nullable column with no default is `required`.
 */
export async function defaultPath(
  name: string,
  meta: FieldQueryMeta,
  wctx: FieldWriteContext,
  inactive = false,
): Promise<Prepared> {
  const options = meta.options as ValueOptions | undefined;
  if (options && hasKey(options, 'default')) {
    const value = await resolveDefaultValue(options.default, wctx);
    return isDefaultShaped(meta, value)
      ? { value }
      : { errors: { [name]: 'validation.invalidValue' } };
  }
  const land = (value: unknown): Prepared => (inactive ? inactiveValue(meta, value) : { value });
  const forbidden = isListField(meta) && forbidsEmpty(meta.options);
  if (meta.kind === 'records' || meta.kind === 'childMany' || meta.kind === 'blocks') {
    return forbidden && !inactive ? { errors: { [name]: 'validation.required' } } : land([]);
  }
  if (meta.kind === 'childOne') return { value: null };
  if (!isUndefined(meta.fieldType?.defaultValue)) {
    const value = await resolveDefaultValue(meta.fieldType.defaultValue, wctx);
    if (!forbidden || !isArray(value) || !isEmpty(value)) return land(value);
  }
  if (meta.nullable) return { value: null };
  if (inactive && isListField(meta)) return land([]);
  return { errors: { [name]: 'validation.required' } };
}

/**
 * Phase A for a column or `record` field: the default path, the null gate, and the soft coerce.
 *
 * An absent field takes its default, except at the top level of an update, where it is skipped.
 * An explicit `undefined` counts as absent, so it can never slip past the null gate as a value.
 * A composite item is always a full item, so its absent subfields default even under an update.
 * A scope snapshot already resolved the absent field's default, so the value is reused, not re-run.
 * A `null` on a non-nullable field is rejected; a nullable `null` carries through, skipping the coerce.
 */
export async function prepareScalar(
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
  if (isNull(value)) {
    if (!meta.nullable) return { errors: { [name]: 'validation.notNullable' } };
    return { value: null, provided: true };
  }
  if (meta.kind === 'record') {
    return isString(value)
      ? { value, provided: true }
      : { errors: { [name]: 'validation.invalidValue' } };
  }
  return { value: coerceColumn(value, meta.logicalType as LogicalType), provided: true };
}

/**
 * Phase B for a column or `record` field: the base-type gate, the sanitizer and validator tiers, serialize.
 *
 * A carried `null` skips every check and stores as-is.
 * A column checks its base type first; a wrong type stops the field.
 * The type tier runs before the instance tier, and any type-tier error skips the instance tier.
 * A `trusted` value skips both tiers and still serializes.
 * A `record` value's reference carries `provided`, whether the input supplied it.
 * A type with `links` adds a weak reference per listed link, at the link's own path.
 */
export async function finishScalar(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
  trusted = false,
  provided = false,
): Promise<FieldOutput> {
  const column = meta.column as string;
  if (isNull(value)) return { column: { name: column, value: null } };

  if (meta.kind === 'column' && !isValidColumn(value, meta.logicalType as LogicalType)) {
    return { errors: { [name]: 'validation.invalidValue' } };
  }

  const wctx = writeContext(name, meta, input, ctx);
  if (!trusted) {
    const errors: FieldErrors = {};
    const tiered = await runTiers(value, meta, wctx, validateContext(wctx, errors));
    if (tiered.error) return { errors: { [name]: tiered.error } };
    if (!isEmpty(errors)) return { errors: prefixErrors(name, errors) };
    value = tiered.value;
  }

  const stored = meta.fieldType?.serialize ? await meta.fieldType.serialize(value, wctx) : value;
  const output: FieldOutput = { column: { name: column, value: stored } };
  if (meta.kind === 'record' && isString(value)) {
    output.refs = [{ path: wctx.path, target: meta.target as string, uuid: value, provided }];
  }
  if (meta.fieldType?.links) {
    output.refs = meta.fieldType.links(value).map(({ path, link }) => ({
      path: prefixPath(wctx.path, path),
      target: link.collection,
      uuid: link.record,
      provided,
      weak: true,
    }));
  }
  return output;
}

/**
 * Runs the four value tiers in order: type sanitizers, type validators, then the instance pair.
 *
 * The first own-message stops the run, returning it verbatim for the boundary to resolve.
 * Any type-tier failure skips both instance tiers.
 * A validator may instead write sub-path failures into `ctx.errors`, which the caller lifts out.
 */
export async function runTiers(
  value: unknown,
  meta: FieldQueryMeta,
  wctx: FieldWriteContext,
  vctx: FieldValidateContext,
): Promise<{ value: unknown; error?: undefined } | { error: Message; value?: undefined }> {
  const options = meta.options as ValueOptions | undefined;
  const typeSanitizers = (meta.fieldType?.sanitizers ?? []) as readonly FieldSanitizer[];
  const typeValidators = (meta.fieldType?.validators ?? []) as readonly FieldValidator[];

  for (const clean of typeSanitizers) value = await clean(value, wctx);
  for (const check of typeValidators) {
    const message = await check(value, vctx);
    if (!isUndefined(message)) return { error: message };
  }
  if (!isEmpty(vctx.errors)) return { value };

  for (const clean of options?.sanitizers ?? []) value = await clean(value, wctx);
  for (const check of options?.validators ?? []) {
    const message = await check(value, vctx);
    if (!isUndefined(message)) return { error: message };
  }
  return { value };
}
