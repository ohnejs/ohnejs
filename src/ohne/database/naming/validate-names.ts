import { isCamelCase, isEmpty, isPascalCase, isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';

const RESERVED_COLLECTIONS = new Set(['ohne', 'block']);

/**
 * Rejects a collection name that is not PascalCase or is reserved.
 * PascalCase is an uppercase letter, then letters and digits: no underscores, spaces, or symbols.
 * `Ohne` and `Block` are reserved case-insensitively.
 * Pass `path` when the name comes from a file, so the error lands on it.
 */
export function validateCollectionName(name: string, path?: string): void {
  if (isEmpty(name, { trim: true })) {
    throw ohneError({
      title: 'A collection name cannot be empty',
      body: ['The name holds no letters or digits to build an identifier from.', 'Rename it.'],
      path,
    });
  }
  if (!isPascalCase(name)) {
    throw ohneError({
      title: `Collection name \`${name}\` is not PascalCase`,
      body: [
        'Collection names are PascalCase: an uppercase letter, then letters and digits.',
        'Rename it.',
      ],
      path,
    });
  }
  if (RESERVED_COLLECTIONS.has(name.toLowerCase())) {
    throw ohneError({
      title: `Collection name \`${name}\` is reserved`,
      body: [
        '`Ohne` and `Block` are reserved framework names, matched case-insensitively.',
        'Rename it.',
      ],
      path,
    });
  }
}

/**
 * Rejects a field name that is not camelCase or collides with the `UUID` primary key.
 * A camelCase name is a lowercase letter, then letters and digits: no underscores, no leading uppercase.
 * A known scope - the collection, or a dotted composite path like `Posts.sections` - sharpens the message.
 * Omit it before the name is known.
 */
export function validateFieldName(name: string, scope?: string): void {
  const where = isUndefined(scope) ? '' : ` in \`${scope}\``;
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
 * Rejects a case-insensitive duplicate within a set of collection names or one scope's field names.
 * The scope is a collection, or a dotted composite path like `Posts.sections`.
 * SQLite matches identifiers case-insensitively even when quoted, so `title` and `Title` cannot coexist.
 */
export function validateUniqueNames(
  names: readonly string[],
  kind: 'collection' | 'field',
  scope?: string,
): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (!isUndefined(first)) {
      const where = isUndefined(scope) ? '' : ` in \`${scope}\``;
      throw ohneError({
        title:
          kind === 'collection'
            ? `Collection names \`${first}\` and \`${name}\` collide`
            : `Field names \`${first}\` and \`${name}\` collide`,
        body: [
          `Identifiers match case-insensitively, so these cannot coexist${where}.`,
          'Rename one of them.',
        ],
      });
    }
    seen.set(key, name);
  }
}
