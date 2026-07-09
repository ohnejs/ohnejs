import type { FieldInstance } from '../fields/field.ts';
import type { CollectionDefinition, CompositeIndex } from './define-collection.ts';

import { isUndefined } from '../../utils/index.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Validates a collection definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - Each composite index must cover only declared fields, at least one, with no repeat.
 * - No two composite indexes may be identical.
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
