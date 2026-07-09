import type { FieldType } from './define-field.ts';
import type { AnyOptionDef } from './option.ts';

import { isCamelCase, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

const RESERVED_OPTIONS = new Set(['nullable', 'unique', 'index']);

/**
 * Rejects a field-type name that is not camelCase.
 * The name comes from the file under `dirs.fields`, so the fix is renaming the file.
 * Pass `path` when the name comes from a file, so the error lands on it.
 */
export function validateFieldTypeName(name: string, path?: string): void {
  if (!isCamelCase(name)) {
    throw ohneError({
      title: `Field-type name \`${name}\` is not camelCase`,
      body: [
        'Field-type names are camelCase: a lowercase letter, then letters and digits.',
        'Rename the file to match.',
      ],
      path,
    });
  }
}

/**
 * Validates a field type's storage members and declared option names.
 *
 * - A column-less type (`columnType: false`) owns no column, so it cannot set `forceNullable` or `index`.
 * - Every declared option name must be camelCase and must not shadow a common option.
 */
export function validateFieldType<TOptions extends Record<string, AnyOptionDef>>(
  type: FieldType<TOptions>,
): void {
  if (type.columnType === false && (type.forceNullable === true || type.index === true)) {
    throw ohneError({
      title: 'A column-less field type cannot set `forceNullable` or `index`',
      body: [
        '`forceNullable` and `index` configure a field type that owns a column.',
        'This type sets `columnType: false`, so drop them or give it a column type.',
      ],
    });
  }
  if (isUndefined(type.options)) return;
  for (const name of Object.keys(type.options)) {
    if (!isCamelCase(name)) {
      throw ohneError({
        title: `Field option \`${name}\` is not camelCase`,
        body: [
          'Option names are camelCase: a lowercase letter, then letters and digits.',
          `Rename \`${name}\`.`,
        ],
      });
    }
    if (RESERVED_OPTIONS.has(name)) {
      throw ohneError({
        title: `Field option \`${name}\` is reserved`,
        body: [
          `\`${name}\` is a common option every field already has, so a field type cannot redeclare it.`,
          `Rename \`${name}\`.`,
        ],
      });
    }
  }
}
