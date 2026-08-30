import type { FieldInstance } from '../fields/field.ts';
import type { CollectionDefinition, CompositeIndex } from './define-collection.ts';

import {
  didYouMean,
  isArray,
  isBoolean,
  isEmpty,
  isFunction,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
} from '../../utils/index.ts';
import { iconNames, isIconName } from '../dashboard/icon-shapes.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useFields } from '../fields/use-fields.ts';

const API_OPERATIONS = new Set(['read', 'create', 'update', 'delete']);

/**
 * Validates a collection definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - Each composite index must cover only declared fields, at least one, with no repeat.
 * - No two composite indexes may be identical.
 * - `api` must be a boolean or a per-operation table of booleans and endpoint options.
 * - `icon` must name an icon the vendored set carries.
 * - `recordLabel` must list distinct, readable, plain text fields, ten at most.
 * - `table.columns` must be a non-empty list of entries naming distinct, readable, declared fields.
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
  validateIcon(definition.icon, collection);
  validateRecordLabel(definition.recordLabel, definition.fields, collection);
  validateTable(definition.table, definition.fields, collection);
}

/**
 * Rejects an `icon` the vendored Tabler set does not carry.
 * The type already narrows this for a TypeScript caller, and the check catches a plain-JS one.
 * A menu row that would silently render no icon becomes a named failure at boot.
 */
function validateIcon(icon: string | undefined, collection?: string): void {
  if (isUndefined(icon) || isIconName(icon)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  const near = didYouMean(icon, iconNames());
  throw ohneError({
    title: `Unknown icon \`${icon}\``,
    body: [
      `The \`icon\` option${scope} names an icon the set does not carry.`,
      isUndefined(near)
        ? 'Every icon is a Tabler original; browse the names at `https://tabler.io/icons`.'
        : `Did you mean \`${near}\`?`,
    ],
  });
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
        "Write `api: true`, or name operations: `api: { read: 'public', create: true }`.",
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
    if (isBoolean(value) || value === 'public') continue;
    const endpoint = isPlainObject(value) ? value : null;
    const middleware = endpoint?.middleware;
    const open = endpoint?.public;
    const access = endpoint?.access;
    const clean =
      !isNull(endpoint) &&
      Object.keys(endpoint).every(
        (key) => key === 'middleware' || key === 'public' || key === 'access',
      ) &&
      (isUndefined(middleware) || (isArray(middleware) && middleware.every(isString))) &&
      (isUndefined(open) || isBoolean(open)) &&
      (isUndefined(access) || isFunction(access));
    if (!clean) {
      throw ohneError({
        title: `Invalid \`api\` operation \`${operation}\``,
        body: [
          `The \`${operation}\` operation${scope} must be a boolean, \`'public'\`, or \`{ public, middleware, access }\`.`,
          '`public` opens it to anyone; `middleware` lists named middleware to run before it, in order;',
          '`access` is a function resolving the per-request scope.',
        ],
      });
    }
  }
}

/**
 * Rejects a malformed `recordLabel` declaration.
 * A failure is a value that is not a field name or an array of them, an empty list, or one past ten.
 * A part fails naming an unknown, write-only, repeated, or non-text field.
 * The text check reads the field-type registry, so an unregistered type defers to the boot pass.
 */
function validateRecordLabel(
  recordLabel: unknown,
  fields: Record<string, FieldInstance>,
  collection?: string,
): void {
  if (isUndefined(recordLabel)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isString(recordLabel) && !(isArray(recordLabel) && recordLabel.every(isString))) {
    throw ohneError({
      title: 'Invalid `recordLabel` declaration',
      body: [
        `The \`recordLabel\` option${scope} must be a field name or an array of field names.`,
        "Write `recordLabel: 'title'` or `recordLabel: ['firstName', 'lastName']`.",
      ],
    });
  }
  const names = isString(recordLabel) ? [recordLabel] : recordLabel;
  if (isEmpty(names)) {
    throw ohneError({
      title: 'The `recordLabel` list is empty',
      body: [
        `An empty \`recordLabel\`${scope} would silently fall back to the derived label.`,
        'Omit the key instead.',
      ],
    });
  }
  if (names.length > 10) {
    throw ohneError({
      title: 'The `recordLabel` lists more than ten fields',
      body: [
        `A record picker orders by every part${scope}, and a query orders by at most ten keys.`,
      ],
    });
  }
  const seen = new Set<string>();
  for (const name of names) {
    const instance = fields[name];
    if (isUndefined(instance)) {
      const near = didYouMean(name, Object.keys(fields));
      throw ohneError({
        title: `\`recordLabel\` references unknown field \`${name}\``,
        body: [
          `No field \`${name}\` is declared${scope}.`,
          ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
        ],
      });
    }
    if (instance.options.readable === false) {
      throw ohneError({
        title: `\`recordLabel\` references write-only field \`${name}\``,
        body: [
          `The field \`${name}\`${scope} is \`readable: false\`, so it can never label a record.`,
        ],
      });
    }
    if (seen.has(name)) {
      throw ohneError({
        title: `\`recordLabel\` repeats field \`${name}\``,
        body: [`A \`recordLabel\` part${scope} may appear once; a repeat adds nothing.`],
      });
    }
    seen.add(name);
    const meta = useFields().get(instance.type);
    if (isUndefined(meta)) continue;
    if (meta.fieldType.columnType !== 'text' || !isUndefined(meta.fieldType.schema)) {
      throw ohneError({
        title: `\`recordLabel\` references non-text field \`${name}\``,
        body: [
          `A label part${scope} must be a plain \`text\` column; \`${name}\` is a \`${instance.type}\` field.`,
        ],
      });
    }
  }
}

// Must stay in sync with the width grammar the dashboard's column parser accepts.
const CSS_WIDTH = /^\d+(\.\d+)?(px|rem|em|ch|vw|vh|vmin|vmax|%)$/;

/**
 * Rejects a malformed `table` declaration.
 * A failure is a non-object `table` or a `columns` that is not a non-empty array of strings.
 * An entry fails naming no field, an unknown or write-only field, a repeat, or an invalid width.
 */
function validateTable(
  table: unknown,
  fields: Record<string, FieldInstance>,
  collection?: string,
): void {
  if (isUndefined(table)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isPlainObject(table)) {
    throw ohneError({
      title: 'Invalid `table` declaration',
      body: [
        `The \`table\` option${scope} must be an object.`,
        "Write `table: { columns: ['title | 20rem', 'views'] }`.",
      ],
    });
  }
  const columns = table.columns;
  if (isUndefined(columns)) return;
  if (!isArray(columns) || !columns.every(isString)) {
    throw ohneError({
      title: 'Invalid `table.columns` declaration',
      body: [
        `The \`table.columns\` option${scope} must be an array of \`name|width|minWidth\` strings.`,
      ],
    });
  }
  if (isEmpty(columns)) {
    throw ohneError({
      title: 'The `table.columns` list is empty',
      body: [
        `An empty \`table.columns\`${scope} would silently show the derived columns.`,
        'Omit the key instead.',
      ],
    });
  }
  const known = new Set([...Object.keys(fields), 'UUID', '_updatedAt']);
  const seen = new Set<string>();
  for (const entry of columns) {
    const [name = '', ...widths] = entry.split('|').map((part) => part.trim());
    if (name === '') {
      throw ohneError({
        title: 'A `table.columns` entry names no field',
        body: [`Every \`table.columns\` entry${scope} must start with a field name.`],
      });
    }
    if (!known.has(name)) {
      throw ohneError({
        title: `\`table.columns\` references unknown field \`${name}\``,
        body: [
          `No field \`${name}\` is declared${scope}, and it is not \`UUID\` or \`_updatedAt\`.`,
        ],
      });
    }
    if (fields[name]?.options.readable === false) {
      throw ohneError({
        title: `\`table.columns\` references write-only field \`${name}\``,
        body: [
          `The field \`${name}\`${scope} is \`readable: false\`, so its column can never show a value.`,
        ],
      });
    }
    if (seen.has(name)) {
      throw ohneError({
        title: `\`table.columns\` repeats field \`${name}\``,
        body: [
          `The table keys columns by field name${scope}, so a repeated \`${name}\` collapses.`,
        ],
      });
    }
    seen.add(name);
    for (const width of widths) {
      if (width !== '' && !CSS_WIDTH.test(width)) {
        throw ohneError({
          title: `Invalid \`table.columns\` width \`${width}\``,
          body: [
            `A width${scope} must be a plain CSS length or percentage, like \`20rem\` or \`50%\`.`,
          ],
        });
      }
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
    if (isEmpty(entry.fields)) {
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
