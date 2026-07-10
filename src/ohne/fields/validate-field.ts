import type { FieldType } from './define-field.ts';
import type { FieldInstance } from './field.ts';
import type { AnyOptionDef } from './option.ts';
import type { StorageHint } from './storage-hint.ts';

import { isCamelCase, isEmpty, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

const RESERVED_OPTIONS = new Set(['nullable', 'unique', 'index']);

/**
 * Arguments to `validateField`.
 */
export interface ValidateFieldArgs {
  /**
   * The collection the field belongs to, for the error messages.
   */
  collection: string;

  /**
   * The field's name in its collection.
   */
  name: string;

  /**
   * The field instance, its options read raw: resolution erases what was explicitly passed.
   */
  instance: FieldInstance;

  /**
   * The field's resolved type.
   */
  fieldType: FieldType;

  /**
   * The storage hint the type's `schema` returned for this instance, if it declares one.
   */
  hint: StorageHint | undefined;
}

/**
 * Validates a field instance against its resolved type and storage hint.
 * Runs when the desired schema builds - the one place every reference is resolved.
 *
 * - A column-less type must declare `schema`; without a hint the field can store nothing.
 * - A `foreignKey` hint requires `columnType: 'text'`: it stores the target's text `UUID`.
 * - A `junction` hint requires `columnType: false`: its links live in the junction table alone.
 * - A `child` hint requires `columnType: false` too, and must declare at least one subfield.
 * - `unique` and `index` need a column, so a column-less field takes neither.
 * - A junction field with no links is empty, never `NULL`, so it takes no `nullable` either.
 * - A child field takes no `nullable`: an absent one-row already reads as `null`, a list is never `NULL`.
 * - A force-nullable type locks `nullable` on, so a field of it takes no `nullable` at all.
 * - A force-index type locks its index on the same terms: the field takes no `index`.
 */
export function validateField(args: ValidateFieldArgs): void {
  const { collection, name, instance, fieldType, hint } = args;
  const where = `Field \`${name}\` in collection \`${collection}\``;
  if (fieldType.columnType === false && isUndefined(hint)) {
    throw ohneError({
      title: `Field type \`${instance.type}\` owns no column and no storage`,
      body: [
        `${where} is \`${instance.type}\`, a column-less type that declares no \`schema\`.`,
        'A `columnType: false` field type must return a storage hint from `schema`.',
      ],
    });
  }
  if (hint?.kind === 'foreignKey' && fieldType.columnType !== 'text') {
    throw ohneError({
      title: `Field type \`${instance.type}\` pairs a foreign key with \`${fieldType.columnType}\``,
      body: [
        "A `foreignKey` hint stores the target row's `UUID`, which is text.",
        `Set \`columnType: 'text'\` on the field type.`,
      ],
    });
  }
  if (hint?.kind === 'junction' && fieldType.columnType !== false) {
    throw ohneError({
      title: `Field type \`${instance.type}\` pairs a junction with a column`,
      body: [
        'A `junction` hint stores its links in the junction table alone.',
        'Set `columnType: false` on the field type.',
      ],
    });
  }
  if (hint?.kind === 'child' && fieldType.columnType !== false) {
    throw ohneError({
      title: `Field type \`${instance.type}\` pairs a child table with a column`,
      body: [
        'A `child` hint stores its rows in the child table alone.',
        'Set `columnType: false` on the field type.',
      ],
    });
  }
  if (hint?.kind === 'child' && isEmpty(hint.subfields)) {
    throw ohneError({
      title: `Composite field \`${name}\` declares no fields`,
      body: [
        `${where} is \`${instance.type}\`, whose storage declares no subfields, so its child table would hold nothing.`,
        'Declare at least one field.',
      ],
    });
  }
  const options: Record<string, unknown> = { ...instance.options };
  if (fieldType.columnType === false) {
    for (const key of ['unique', 'index'] as const) {
      if (isUndefined(options[key])) continue;
      throw ohneError({
        title: `Field \`${name}\` has no column to constrain`,
        body: [
          `${where} is \`${instance.type}\`, which owns no column, so \`${key}\` cannot apply.`,
          `Drop \`${key}\`.`,
        ],
      });
    }
  }
  if (hint?.kind === 'junction' && !isUndefined(options.nullable)) {
    throw ohneError({
      title: `Field \`${name}\` cannot be nullable`,
      body: [
        `${where} is a junction: with no links it is empty, never \`NULL\`.`,
        'Drop `nullable`.',
      ],
    });
  }
  if (hint?.kind === 'child' && !isUndefined(options.nullable)) {
    throw ohneError({
      title: `Field \`${name}\` cannot be nullable`,
      body: [
        hint.cardinality === 'one'
          ? `${where} holds at most one child row, and an absent row already reads as \`null\`.`
          : `${where} is an ordered list: with no items it is empty, never \`NULL\`.`,
        'Drop `nullable`.',
      ],
    });
  }
  if (!isUndefined(options.nullable) && fieldType.forceNullable === true) {
    throw ohneError({
      title: `Field \`${name}\` cannot set \`nullable\``,
      body: [
        `${where} is \`${instance.type}\`, which locks the column nullable; the flag is not the field's to set.`,
        'Drop `nullable`.',
      ],
    });
  }
  if (!isUndefined(options.index) && fieldType.forceIndex === true) {
    throw ohneError({
      title: `Field \`${name}\` cannot set \`index\``,
      body: [
        `${where} is \`${instance.type}\`, which locks the index onto the column; the flag is not the field's to set.`,
        'Drop `index`.',
      ],
    });
  }
}

/**
 * Rejects a field-type name that is empty or not camelCase.
 * The name comes from the file under `dirs.fields`, so the fix is renaming the file.
 * Pass `path` when the name comes from a file, so the error lands on it.
 */
export function validateFieldTypeName(name: string, path?: string): void {
  if (isEmpty(name, { trim: true })) {
    throw ohneError({
      title: 'A field-type name cannot be empty',
      body: ['The name holds no letters or digits to build an identifier from.', 'Rename it.'],
      path,
    });
  }
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
 * - A column-less type (`columnType: false`) owns no column, so it cannot force `nullable` or an index.
 * - `emitType` and `schema` are mutually exclusive: the framework derives value types from the hint.
 * - Every declared option name must be camelCase and must not shadow a common option.
 */
export function validateFieldType<TOptions extends Record<string, AnyOptionDef>>(
  type: FieldType<TOptions>,
): void {
  if (type.columnType === false && (type.forceNullable === true || type.forceIndex === true)) {
    throw ohneError({
      title: 'A column-less field type cannot set `forceNullable` or `forceIndex`',
      body: [
        '`forceNullable` and `forceIndex` configure a field type that owns a column.',
        'This type sets `columnType: false`, so drop them or give it a column type.',
      ],
    });
  }
  if (!isUndefined(type.schema) && !isUndefined(type.emitType)) {
    throw ohneError({
      title: 'A field type cannot declare both `schema` and `emitType`',
      body: [
        'The framework derives the value type of a `schema` field from its storage hint.',
        'Drop `emitType`.',
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
