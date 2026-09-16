import type { Transaction } from '../database/adapter.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { FieldQueryMeta } from './metadata.ts';
import type { FieldErrors } from './write/errors.ts';

import { literalString } from '../../utils/codegen/index.ts';
import { first, hasKey, isFunction, isNull, isString, isUndefined } from '../../utils/index.ts';
import { useBlocks } from '../blocks/use-blocks.ts';
import { useCollections } from '../collections/use-collections.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveMessage } from '../http/translate.ts';
import { blockQueryMetadata, queryMetadata } from './metadata.ts';
import { prefixErrors } from './pipeline/prefix-errors.ts';
import { isValidColumn } from './pipeline/preflight.ts';
import { runTiers, validateContext, writeContext } from './pipeline/run-field.ts';

/**
 * One scope's fields, keyed by name: a collection's fields, a block's, or a composite's subfields.
 */
type Scope = Record<string, FieldQueryMeta>;

/**
 * What every field in one walk shares: the transaction, the owner's name, and its rendered phrase.
 */
interface Owner {
  tx: Transaction;
  collection: string;
  home: string;
}

/**
 * Validates every literal default against the gate and tiers a create runs it through.
 *
 * A literal default is a constant, so a create that omits its field either always lands it or always fails.
 * Each one runs its field's base-type gate and tiers once here, inside `tx`, exactly as a create would.
 * A callback default computes from the write's input, so it stays checked per write.
 * The walk covers every collection and every block, composite subfields included.
 * A block has no host here, so its fields see the block's name as `ctx.collection`.
 * A rejected default throws `ohneError`, naming the field, its owner, and the message a create would return.
 */
export async function validateLiteralDefaults(tx: Transaction): Promise<void> {
  for (const meta of Object.values(useCollections().all())) {
    const home = `collection \`${meta.name}\``;
    await walkScope(queryMetadata(meta.name).fields, '', { tx, collection: meta.name, home });
  }
  for (const name of useBlocks().keys()) {
    const home = `block \`${name}\``;
    await walkScope(blockQueryMetadata(name).fields, '', { tx, collection: name, home });
  }
}

/**
 * Walks one scope, checking each literal scalar default, then recursing into every composite subfield scope.
 * `path` is the dotted label from the owner, so a nested failure names `sections.heading`.
 */
async function walkScope(scope: Scope, path: string, owner: Owner): Promise<void> {
  for (const [name, meta] of Object.entries(scope)) {
    const label = path === '' ? name : `${path}.${name}`;
    if ((meta.kind === 'column' || meta.kind === 'record') && hasLiteralDefault(meta)) {
      await checkDefault(name, label, path, meta, owner);
    }
    if (meta.kind === 'childOne' || meta.kind === 'childMany') {
      await walkScope(meta.subfields as Scope, label, owner);
    }
  }
}

/**
 * Whether a field carries a default the check can run: present, not `null`, and not a callback.
 * A `null` default lands untiered, and `validateField` already proves the field can hold it.
 */
function hasLiteralDefault(meta: FieldQueryMeta): boolean {
  if (isUndefined(meta.options) || !hasKey(meta.options, 'default')) return false;
  const value = meta.options.default;
  return !isUndefined(value) && !isNull(value) && !isFunction(value);
}

/**
 * Runs one literal default through the base-type gate and the tiers, throwing on the first failure.
 */
async function checkDefault(
  name: string,
  label: string,
  path: string,
  meta: FieldQueryMeta,
  owner: Owner,
): Promise<void> {
  const value = meta.options?.default;
  const failure = first(Object.entries(await failuresOf(name, path, value, meta, owner)));
  if (isUndefined(failure)) return;
  const [at, message] = failure;
  const where = at === name ? '' : ` at \`${at}\``;
  throw ohneError({
    title: `Field \`${label}\` defaults to a value it rejects`,
    body: [
      `Field \`${label}\` in ${owner.home} defaults to \`${shown(value)}\`.`,
      `Its validators reject that value${where}: ${resolveMessage(message)}.`,
      'Change the default, or the option that rejects it.',
    ],
  });
}

/**
 * The failures a create would record for `value` landing on the field: the gate's, or the tiers'.
 */
async function failuresOf(
  name: string,
  path: string,
  value: unknown,
  meta: FieldQueryMeta,
  owner: Owner,
): Promise<FieldErrors> {
  if (meta.kind === 'column' && !isValidColumn(value, meta.logicalType as LogicalType)) {
    return { [name]: 'validation.invalidValue' };
  }
  const ctx = {
    operation: 'create',
    collection: owner.collection,
    tx: owner.tx,
    path,
    ancestors: [],
  } as const;
  const wctx = writeContext(name, meta, {}, ctx);
  const errors: FieldErrors = {};
  const tiered = await runTiers(value, meta, wctx, validateContext(wctx, errors));
  if (tiered.error) return { [name]: tiered.error };
  return prefixErrors(name, errors);
}

/**
 * The default as the collection file spells it: a quoted string, or the JSON form of any other value.
 */
function shown(value: unknown): string {
  return isString(value) ? literalString(value) : JSON.stringify(value);
}
