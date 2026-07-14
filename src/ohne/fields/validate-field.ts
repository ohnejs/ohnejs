import type { FieldType } from './define-field.ts';
import type { FieldInstance } from './field.ts';
import type { AnyOptionDef } from './option.ts';
import type { StorageHint } from './storage-hint.ts';

import {
  hasKey,
  isArray,
  isCamelCase,
  isEmpty,
  isFunction,
  isNull,
  isUndefined,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

const RESERVED_OPTIONS = new Set([
  'nullable',
  'unique',
  'index',
  'translatable',
  'uniquePerLocale',
  'uniquePerParent',
  'default',
  'sanitizers',
  'validators',
]);

/**
 * The definition root a field tree hangs off: a collection, or a block's per-type table.
 */
export interface FieldOwner {
  /**
   * Whether a collection or a block declares the field tree.
   */
  kind: 'collection' | 'block';

  /**
   * The owner's name.
   */
  name: string;
}

/**
 * An owner as the error messages locate a field: 'collection `Posts`' or 'block `Hero`'.
 */
export function ownerLabel(owner: FieldOwner): string {
  return `${owner.kind} \`${owner.name}\``;
}

/**
 * An owner as the error messages open a sentence: 'Collection `Posts`' or 'Block `Hero`'.
 */
export function ownerSubject(owner: FieldOwner): string {
  return owner.kind === 'collection' ? `Collection \`${owner.name}\`` : `Block \`${owner.name}\``;
}

/**
 * Arguments to `validateField`.
 */
export interface ValidateFieldArgs {
  /**
   * The collection or block the field lives in.
   */
  owner: FieldOwner;

  /**
   * The field's name in its owner.
   */
  name: string;

  /**
   * Whether the field sits below a composite, as a subfield.
   * Per-field `translatable` is top-level only, so a nested one is rejected here.
   */
  nested: boolean;

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
 * - A `blocks` hint requires `columnType: false` too; its `allow` must not be empty or repeat a name.
 * - The unique flags and `index` need a column, so a column-less field takes none.
 * - A junction field with no links is empty, never `NULL`, so it takes no `nullable` either.
 * - A child field takes no `nullable`: an absent one-row already reads as `null`, a list is never `NULL`.
 * - A blocks field takes no `nullable` on the same terms: with no blocks it is empty, never `NULL`.
 * - A force-nullable type locks `nullable` on, so a field of it takes no `nullable` at all.
 * - A force-index type locks its index on the same terms: the field takes no `index`.
 * - `translatable` is a top-level collection field's flag: subfields and block fields reject it.
 * - An `inverse` field follows the owning side's junction, so it rejects `translatable` too.
 * - `uniquePerLocale` narrows a unique on a translatable field, so it requires both flags.
 * - `uniquePerParent` narrows a unique too, so it requires the flag; its placement is the schema's rule.
 */
export function validateField(args: ValidateFieldArgs): void {
  const { owner, name, nested, instance, fieldType, hint } = args;
  const where = `Field \`${name}\` in ${ownerLabel(owner)}`;
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
  if (hint?.kind === 'blocks' && fieldType.columnType !== false) {
    throw ohneError({
      title: `Field type \`${instance.type}\` pairs a blocks wrapper with a column`,
      body: [
        'A `blocks` hint stores its references in the wrapper table alone.',
        'Set `columnType: false` on the field type.',
      ],
    });
  }
  if (hint?.kind === 'blocks' && !isUndefined(hint.allow)) {
    if (hint.allow.length === 0) {
      throw ohneError({
        title: `Field \`${name}\` allows no block types`,
        body: [
          `${where} sets \`allow: []\`, so the field could never hold a block.`,
          'List at least one block, or drop `allow` to accept every registered one.',
        ],
      });
    }
    const seen = new Set<string>();
    for (const block of hint.allow) {
      if (seen.has(block)) {
        throw ohneError({
          title: `Field \`${name}\` lists block \`${block}\` twice`,
          body: [`${where} repeats \`${block}\` in \`allow\`.`, 'Drop the duplicate.'],
        });
      }
      seen.add(block);
    }
  }
  const options: Record<string, unknown> = { ...instance.options };
  if (fieldType.columnType === false) {
    for (const key of ['unique', 'uniquePerLocale', 'uniquePerParent', 'index'] as const) {
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
  if (options.translatable === true && owner.kind === 'block') {
    throw ohneError({
      title: `Field \`${name}\` cannot be translatable`,
      body: [
        `${where} belongs to a block, and a block's fields are never individually translatable.`,
        'Mark the collection field holding the blocks translatable instead.',
      ],
    });
  }
  if (options.translatable === true && nested) {
    throw ohneError({
      title: `Field \`${name}\` cannot be translatable`,
      body: [
        `${where} is a subfield, and a composite is per-locale as a whole.`,
        'Mark the top-level composite translatable instead.',
      ],
    });
  }
  if (options.translatable === true && hint?.kind === 'junction' && !isUndefined(hint.inverse)) {
    throw ohneError({
      title: `Field \`${name}\` cannot be translatable`,
      body: [
        "An inverse field reuses the owning side's junction, so the owning field decides translatability.",
        'Drop `translatable`.',
      ],
    });
  }
  if (options.uniquePerLocale === true) {
    const missing = [
      ...(options.unique === true ? [] : ['unique']),
      ...(options.translatable === true ? [] : ['translatable']),
    ];
    if (missing.length > 0) {
      throw ohneError({
        title: `Field \`${name}\` cannot scope its unique per locale`,
        body: [
          '`uniquePerLocale` narrows a unique on a translatable field to one locale.',
          `Set ${missing.map((key) => `\`${key}: true\``).join(' and ')} alongside it.`,
        ],
      });
    }
  }
  if (options.uniquePerParent === true && options.unique !== true) {
    throw ohneError({
      title: `Field \`${name}\` cannot scope its unique per parent`,
      body: [
        "`uniquePerParent` narrows a unique to one parent's item list.",
        'Set `unique: true` alongside it.',
      ],
    });
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
  if (hint?.kind === 'blocks' && !isUndefined(options.nullable)) {
    throw ohneError({
      title: `Field \`${name}\` cannot be nullable`,
      body: [
        `${where} is an ordered list of blocks: with no blocks it is empty, never \`NULL\`.`,
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
  if (hasKey(options, 'default') && !isUndefined(options.default)) {
    const value = options.default;
    const valueShapeNullable =
      hint?.kind === 'child'
        ? hint.cardinality === 'one'
        : hint?.kind === 'junction' || hint?.kind === 'blocks'
          ? false
          : options.nullable === true || fieldType.forceNullable === true;
    if (isNull(value) && !valueShapeNullable) {
      throw ohneError({
        title: `Field \`${name}\` cannot default to \`null\``,
        body: [
          `${where} has no nullable value shape, so \`null\` is not a value it can hold.`,
          'Make the field nullable, or drop the `null` default.',
        ],
      });
    }
    if (
      (hint?.kind === 'junction' || hint?.kind === 'child') &&
      !isNull(value) &&
      !isFunction(value)
    ) {
      throw ohneError({
        title: `Field \`${name}\` needs a callback default`,
        body: [
          `${where} is a relation or composite; a shared literal default would be shared mutable state.`,
          'Return it from a callback instead: `default: () => []`.',
        ],
      });
    }
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
 * - `sanitizers` and `validators` are lists of functions, run in order by the write pipeline.
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
  for (const member of ['sanitizers', 'validators'] as const) {
    const value = type[member];
    if (!isUndefined(value) && (!isArray(value) || !value.every(isFunction))) {
      throw ohneError({
        title: `A field type's \`${member}\` must be an array of functions`,
        body: [
          `\`${member}\` is a list of value functions the write pipeline runs in order.`,
          `Set \`${member}\` to an array.`,
        ],
      });
    }
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
