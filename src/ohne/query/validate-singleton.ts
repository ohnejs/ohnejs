import type { CollectionQueryMeta } from './metadata.ts';

import { ohneError } from '../error/ohne-error.ts';
import { landsWithoutInput } from './validate-when.ts';

/**
 * Validates the declared fields of a singleton against its one-record invariant.
 *
 * The record is created from the field defaults alone, so a bare required field would fail the seed.
 * A top-level `onDelete: 'cascade'` reference would delete the record along with the row it points at.
 * Composite subfields are not walked: an omitted composite lands `null` or `[]` as a whole.
 * A cascade inside a composite removes only that item, never the record.
 * A violation throws `ohneError`, naming the field and its collection.
 */
export function validateSingleton(meta: CollectionQueryMeta, declared: readonly string[]): void {
  if (meta.singleton !== true) return;
  for (const name of declared) {
    const field = meta.fields[name];
    if (!landsWithoutInput(field)) {
      throw ohneError({
        title: `Singleton field \`${name}\` must be nullable or have a default`,
        body: [
          `Field \`${name}\` in collection \`${meta.collection}\` is neither nullable nor defaulted.`,
          'The record is created from the field defaults when the schema syncs, so every field needs a value.',
          'Make the field `nullable` or give it a `default`.',
        ],
      });
    }
    if (field.kind === 'record' && field.options?.onDelete === 'cascade') {
      throw ohneError({
        title: `Singleton field \`${name}\` cannot cascade`,
        body: [
          `Field \`${name}\` in collection \`${meta.collection}\` sets \`onDelete: 'cascade'\`.`,
          'A delete of the referenced record would delete the one record the singleton holds.',
          'Use `setNull` or `restrict` instead.',
        ],
      });
    }
  }
}
