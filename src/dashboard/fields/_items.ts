import type { DashboardBlock, DashboardField } from '../runtime/meta-types.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';

/**
 * The block type `name` describes, or `undefined` when the discovery read does not list it.
 */
export function blockNamed(
  blocks: readonly DashboardBlock[],
  name: string,
): DashboardBlock | undefined {
  return blocks.find((block) => block.name === name);
}

/**
 * Whether an item form can round-trip items over `fields` without losing or corrupting data.
 *
 * A write-only subfield's value can neither render nor carry, so an item write would blank it.
 * A `blocks` subfield needs every type it admits described, since a carried item is rebuilt from that.
 * The walk follows `allow` by name and tolerates cycles.
 * A block that admits its own type is supported by whatever else it reaches.
 */
export function itemFormSupports(
  fields: readonly DashboardField[],
  blocks: readonly DashboardBlock[],
): boolean {
  return supports(fields, blocks, new Set());
}

/**
 * Whether the subfield's initial value carries into the write: writable, mutable, not the item `UUID`.
 */
export function carriedField(field: DashboardField): boolean {
  return field.writable && !field.immutable && field.name !== 'UUID';
}

/**
 * The carried value, sanitized to what the wire accepts at the subfield's kind.
 * Child items shed rejected keys recursively; only `childMany` items keep their `UUID`s.
 */
export function carryValue(
  field: DashboardField,
  value: unknown,
  blocks: readonly DashboardBlock[],
): unknown {
  if (isUndefined(value)) return undefined;
  if (field.kind === 'childOne') {
    if (!isPlainObject<Record<string, unknown>>(value)) return null;
    return sanitizeItem(field.subfields ?? [], value, false, blocks);
  }
  if (field.kind === 'childMany') {
    if (!isArray(value)) return [];
    return value
      .filter((item) => isPlainObject<Record<string, unknown>>(item))
      .map((item) => sanitizeItem(field.subfields ?? [], item, true, blocks));
  }
  if (field.kind === 'blocks') {
    if (!isArray(value)) return [];
    return value
      .filter((item) => isPlainObject<Record<string, unknown>>(item))
      .map((item) => blockEnvelope(item, blocks));
  }
  return value;
}

/**
 * One carried item, rebuilt from its metadata so only wire-accepted keys survive.
 */
export function sanitizeItem(
  fields: readonly DashboardField[],
  item: Readonly<Record<string, unknown>>,
  attachUUID: boolean,
  blocks: readonly DashboardBlock[],
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const field of fields) {
    if (!carriedField(field)) continue;
    const carried = carryValue(field, item[field.name], blocks);
    if (!isUndefined(carried)) clean[field.name] = carried;
  }
  if (attachUUID && isString(item.UUID)) clean.UUID = item.UUID;
  return clean;
}

/**
 * One carried blocks item as the wire takes it: the type beside its fields, the instance `UUID` kept.
 * The `UUID` rides the envelope, never `fields`, and an update correlates the instance by it.
 *
 * A type the discovery read does not describe cannot be sanitized, so its fields pass through whole.
 * Stored data can outlive an `allow` list, and the server answers `unknownBlock` at its `block` path.
 * That is a visible refusal, where rebuilding from absent metadata would blank the item.
 */
function blockEnvelope(
  item: Readonly<Record<string, unknown>>,
  blocks: readonly DashboardBlock[],
): Record<string, unknown> {
  const name = isString(item.block) ? item.block : '';
  const block = blockNamed(blocks, name);
  const fields = isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : {};
  const envelope: Record<string, unknown> = { block: name };
  if (isString(item.UUID)) envelope.UUID = item.UUID;
  envelope.fields = isUndefined(block) ? fields : sanitizeItem(block.fields, fields, false, blocks);
  return envelope;
}

/**
 * The support walk, carrying the block types already visited so a cyclic graph terminates.
 */
function supports(
  fields: readonly DashboardField[],
  blocks: readonly DashboardBlock[],
  seen: Set<string>,
): boolean {
  return fields.every((field) => {
    if (field.name === 'UUID') return true;
    if (!field.readable) return false;
    if (field.kind === 'blocks') return admitted(field.allow ?? [], blocks, seen);
    if (isUndefined(field.subfields)) return true;
    return supports(field.subfields, blocks, seen);
  });
}

/**
 * Whether every admitted block type is described and itself round-trippable.
 */
function admitted(
  allow: readonly string[],
  blocks: readonly DashboardBlock[],
  seen: Set<string>,
): boolean {
  return allow.every((name) => {
    if (seen.has(name)) return true;
    const block = blockNamed(blocks, name);
    if (isUndefined(block)) return false;
    seen.add(name);
    return supports(block.fields, blocks, seen);
  });
}
