import { isCamelCase, isEmpty, isPascalCase, isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';

const RESERVED_COLLECTIONS = new Set(['ohne', 'block']);

/**
 * Rejects a collection name that is not PascalCase or is reserved.
 * PascalCase is an uppercase letter, then letters and digits: no underscores, spaces, or symbols.
 * Underscores are barred because a single `_` builds derived names and `__` marks framework names.
 * `Ohne` and `Block` are reserved case-insensitively.
 */
export function validateCollectionName(name: string): void {
  if (isEmpty(name, { trim: true })) {
    throw ohneError('A collection name cannot be empty');
  }
  if (!isPascalCase(name)) {
    throw ohneError({
      title: `Collection name \`${name}\` is not PascalCase`,
      body: [
        'Collection names are PascalCase: an uppercase letter, then letters and digits, no underscores.',
        'A single `_` builds derived names and `__` marks framework names, so a name holds neither.',
      ],
    });
  }
  if (RESERVED_COLLECTIONS.has(name.toLowerCase())) {
    throw ohneError({
      title: `Collection name \`${name}\` is reserved`,
      body: [
        '`Ohne` and `Block` are reserved framework names, matched case-insensitively.',
        'Rename it.',
      ],
    });
  }
}

/**
 * Rejects a field name that is not camelCase or collides with the `UUID` primary key.
 * A camelCase name is a lowercase letter, then letters and digits: no underscores, no leading uppercase.
 * A known collection name sharpens the message; omit it before the name is known.
 */
export function validateFieldName(name: string, collection?: string): void {
  const where = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (isEmpty(name, { trim: true })) {
    throw ohneError(`A field name${where} cannot be empty`);
  }
  if (!isCamelCase(name)) {
    throw ohneError({
      title: `Field name \`${name}\` is not camelCase`,
      body: [
        'Field names are camelCase: a lowercase letter, then letters and digits, no underscores.',
        `Rename \`${name}\`${where}.`,
      ],
    });
  }
  if (name.toLowerCase() === 'uuid') {
    throw ohneError({
      title: `Field name \`${name}\` is reserved`,
      body: [
        '`uuid` collides with the `UUID` primary key on case-insensitive dialects.',
        `Rename it${where}.`,
      ],
    });
  }
}

/**
 * Rejects a case-insensitive duplicate within a set of collection names or a collection's field names.
 * SQLite matches identifiers case-insensitively even when quoted, so `title` and `Title` cannot coexist.
 */
export function validateUniqueNames(
  names: readonly string[],
  kind: 'collection' | 'field',
  collection?: string,
): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (!isUndefined(first)) {
      const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
      throw ohneError({
        title:
          kind === 'collection'
            ? `Collection names \`${first}\` and \`${name}\` collide`
            : `Field names \`${first}\` and \`${name}\` collide`,
        body: [
          `Identifiers match case-insensitively, so these cannot coexist${scope}.`,
          'Rename one of them.',
        ],
      });
    }
    seen.set(key, name);
  }
}
