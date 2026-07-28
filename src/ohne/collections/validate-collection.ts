import type { FieldInstance } from '../fields/field.ts';
import type { CollectionDefinition, CompositeIndex } from './define-collection.ts';

import {
  isArray,
  isBoolean,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
} from '../../utils/index.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';

const API_OPERATIONS = new Set(['read', 'create', 'update', 'delete']);

/**
 * Validates a collection definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - Each composite index must cover only declared fields, at least one, with no repeat.
 * - No two composite indexes may be identical.
 * - `api` must be a boolean or a per-operation table of booleans and endpoint options.
 * - A known collection name sharpens the messages; omit it before the name is known.
 */
export function validateCollectionDefinition<TFields extends Record<string, FieldInstance>>(
  definition: CollectionDefinition<TFields>,
  collection?: string,
): void {
  const fieldNames = Object.keys(definition.fields);
  for (const name of fieldNames) validateFieldName(name, collection);
  validateUniqueNames(fieldNames, 'field', collection);
  validateCompositeIndexes(definition.compositeIndexes ?? [], fieldNames, collection);
  validateAPI(definition.api, collection);
}

/**
 * Rejects a malformed `api` exposure.
 * A failure is a non-boolean, non-object value, an unknown operation key, or a malformed operation.
 */
function validateAPI(api: unknown, collection?: string): void {
  if (isUndefined(api) || isBoolean(api)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isPlainObject(api)) {
    throw ohneError({
      title: 'Invalid `api` exposure',
      body: [
        `The \`api\` option${scope} must be a boolean or a per-operation object.`,
        "Write `api: true`, or name operations: `api: { read: true, create: { middleware: ['require-auth'] } }`.",
      ],
    });
  }
  for (const [operation, value] of Object.entries(api)) {
    if (!API_OPERATIONS.has(operation)) {
      throw ohneError({
        title: `Unknown \`api\` operation \`${operation}\``,
        body: [
          `The \`api\` option${scope} names \`${operation}\`.`,
          'The operations are `read`, `create`, `update`, and `delete`.',
        ],
      });
    }
    if (isBoolean(value)) continue;
    const endpoint = isPlainObject(value) ? value : null;
    const middleware = endpoint?.middleware;
    const clean =
      !isNull(endpoint) &&
      Object.keys(endpoint).every((key) => key === 'middleware') &&
      (isUndefined(middleware) || (isArray(middleware) && middleware.every(isString)));
    if (!clean) {
      throw ohneError({
        title: `Invalid \`api\` operation \`${operation}\``,
        body: [
          `The \`${operation}\` operation${scope} must be a boolean or \`{ middleware: [...] }\`.`,
          '`middleware` lists named middleware to run before it, in order.',
        ],
      });
    }
  }
}

/**
 * Rejects a malformed composite index.
 * A failure is an empty field list, an unknown or repeated field, or a duplicate of another entry.
 */
function validateCompositeIndexes(
  entries: readonly CompositeIndex[],
  fieldNames: readonly string[],
  collection?: string,
): void {
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  const known = new Set(fieldNames);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.fields.length === 0) {
      throw ohneError({
        title: 'A composite index covers no fields',
        body: [`Every \`compositeIndexes\` entry${scope} must list at least one field.`],
      });
    }
    const within = new Set<string>();
    for (const name of entry.fields) {
      if (!known.has(name)) {
        throw ohneError({
          title: `Composite index references unknown field \`${name}\``,
          body: [`No field \`${name}\` is declared${scope}.`],
        });
      }
      if (within.has(name)) {
        throw ohneError({
          title: `Composite index repeats field \`${name}\``,
          body: [`A \`compositeIndexes\` entry${scope} lists \`${name}\` more than once.`],
        });
      }
      within.add(name);
    }
    const signature = `${entry.unique === true ? 'U' : 'I'}:${entry.fields.join(',')}`;
    if (seen.has(signature)) {
      throw ohneError({
        title: 'Duplicate composite index',
        body: [`Two \`compositeIndexes\` entries${scope} cover the same fields in the same order.`],
      });
    }
    seen.add(signature);
  }
}
