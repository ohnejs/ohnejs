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
 * - `copyTranslation` must be a function, on a collection with at least one translatable field.
 * - `dashboard` must be an object holding only `icon`, `recordLabel`, and `table`.
 * - `dashboard.icon` must name an icon the vendored set carries.
 * - `dashboard.recordLabel` must list distinct, readable, plain text fields, ten at most.
 * - `dashboard.table.columns` must be a non-empty list naming distinct, readable, declared fields.
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
  validateCopyTranslation(definition.copyTranslation, definition.fields, collection);
  validateDashboard(definition.dashboard, definition.fields, collection);
}

const DASHBOARD_KEYS = new Set(['icon', 'recordLabel', 'table']);

/**
 * Rejects a malformed `dashboard` declaration.
 * A failure is a non-object value or an unknown key; each known key then validates on its own.
 */
function validateDashboard(
  dashboard: unknown,
  fields: Record<string, FieldInstance>,
  collection?: string,
): void {
  if (isUndefined(dashboard)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isPlainObject(dashboard)) {
    throw ohneError({
      title: 'Invalid `dashboard` declaration',
      body: [
        `The \`dashboard\` option${scope} must be an object.`,
        "Write `dashboard: { icon: 'note', recordLabel: 'title' }`.",
      ],
    });
  }
  for (const key of Object.keys(dashboard)) {
    if (!DASHBOARD_KEYS.has(key)) {
      throw ohneError({
        title: `Unknown \`dashboard\` key \`${key}\``,
        body: [
          `The \`dashboard\` option${scope} names \`${key}\`.`,
          'The keys are `icon`, `recordLabel`, and `table`.',
        ],
      });
    }
  }
  validateIcon(dashboard.icon, collection);
  validateRecordLabel(dashboard.recordLabel, fields, collection);
  validateTable(dashboard.table, fields, collection);
}

/**
 * Rejects a `dashboard.icon` the vendored Tabler set does not carry.
 * The type already narrows this for a TypeScript caller, and the check catches a plain-JS one.
 * A menu row that would silently render no icon becomes a named failure at boot.
 */
function validateIcon(icon: unknown, collection?: string): void {
  if (isUndefined(icon)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isString(icon)) {
    throw ohneError({
      title: 'Invalid `dashboard.icon` declaration',
      body: [`The \`dashboard.icon\` option${scope} must be an icon name.`],
    });
  }
  if (isIconName(icon)) return;
  const near = didYouMean(icon, iconNames());
  throw ohneError({
    title: `Unknown icon \`${icon}\``,
    body: [
      `The \`dashboard.icon\` option${scope} names an icon the set does not carry.`,
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
 * Rejects a malformed `copyTranslation` declaration.
 * A failure is a non-function value, or a function on a collection with no translatable field.
 * A hook no translation could ever reach is dead config, named at boot rather than kept silent.
 */
function validateCopyTranslation(
  copyTranslation: unknown,
  fields: Record<string, FieldInstance>,
  collection?: string,
): void {
  if (isUndefined(copyTranslation)) return;
  const scope = isUndefined(collection) ? '' : ` in collection \`${collection}\``;
  if (!isFunction(copyTranslation)) {
    throw ohneError({
      title: 'Invalid `copyTranslation` declaration',
      body: [
        `The \`copyTranslation\` option${scope} must be a function.`,
        'It receives the copy context and returns the write input.',
      ],
    });
  }
  const translatable = Object.values(fields).some(
    (instance) => instance.options.translatable === true,
  );
  if (!translatable) {
    throw ohneError({
      title: '`copyTranslation` needs a translatable field',
      body: [
        `No field${scope} is \`translatable\`, so no translation could ever copy.`,
        'Mark a field `translatable: true`, or drop the option.',
      ],
    });
  }
}

/**
 * Rejects a malformed `dashboard.recordLabel` declaration.
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
      title: 'Invalid `dashboard.recordLabel` declaration',
      body: [
        `The \`dashboard.recordLabel\` option${scope} must be a field name or an array of field names.`,
        "Write `recordLabel: 'title'` or `recordLabel: ['firstName', 'lastName']`.",
      ],
    });
  }
  const names = isString(recordLabel) ? [recordLabel] : recordLabel;
  if (isEmpty(names)) {
    throw ohneError({
      title: 'The `dashboard.recordLabel` list is empty',
      body: [
        `An empty \`recordLabel\`${scope} would silently fall back to the derived label.`,
        'Omit the key instead.',
      ],
    });
  }
  if (names.length > 10) {
    throw ohneError({
      title: 'The `dashboard.recordLabel` lists more than ten fields',
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
        title: `\`dashboard.recordLabel\` references unknown field \`${name}\``,
        body: [
          `No field \`${name}\` is declared${scope}.`,
          ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
        ],
      });
    }
    if (instance.options.readable === false) {
      throw ohneError({
        title: `\`dashboard.recordLabel\` references write-only field \`${name}\``,
        body: [
          `The field \`${name}\`${scope} is \`readable: false\`, so it can never label a record.`,
        ],
      });
    }
    if (seen.has(name)) {
      throw ohneError({
        title: `\`dashboard.recordLabel\` repeats field \`${name}\``,
        body: [`A \`recordLabel\` part${scope} may appear once; a repeat adds nothing.`],
      });
    }
    seen.add(name);
    const meta = useFields().get(instance.type);
    if (isUndefined(meta)) continue;
    if (meta.fieldType.columnType !== 'text' || !isUndefined(meta.fieldType.schema)) {
      throw ohneError({
        title: `\`dashboard.recordLabel\` references non-text field \`${name}\``,
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
 * Rejects a malformed `dashboard.table` declaration.
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
      title: 'Invalid `dashboard.table` declaration',
      body: [
        `The \`dashboard.table\` option${scope} must be an object.`,
        "Write `table: { columns: ['title | 20rem', 'views'] }`.",
      ],
    });
  }
  const columns = table.columns;
  if (isUndefined(columns)) return;
  if (!isArray(columns) || !columns.every(isString)) {
    throw ohneError({
      title: 'Invalid `dashboard.table.columns` declaration',
      body: [
        `The \`dashboard.table.columns\` option${scope} must be an array of \`name|width|minWidth\` strings.`,
      ],
    });
  }
  if (isEmpty(columns)) {
    throw ohneError({
      title: 'The `dashboard.table.columns` list is empty',
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
        title: 'A `dashboard.table.columns` entry names no field',
        body: [`Every \`table.columns\` entry${scope} must start with a field name.`],
      });
    }
    if (!known.has(name)) {
      throw ohneError({
        title: `\`dashboard.table.columns\` references unknown field \`${name}\``,
        body: [
          `No field \`${name}\` is declared${scope}, and it is not \`UUID\` or \`_updatedAt\`.`,
        ],
      });
    }
    if (fields[name]?.options.readable === false) {
      throw ohneError({
        title: `\`dashboard.table.columns\` references write-only field \`${name}\``,
        body: [
          `The field \`${name}\`${scope} is \`readable: false\`, so its column can never show a value.`,
        ],
      });
    }
    if (seen.has(name)) {
      throw ohneError({
        title: `\`dashboard.table.columns\` repeats field \`${name}\``,
        body: [
          `The table keys columns by field name${scope}, so a repeated \`${name}\` collapses.`,
        ],
      });
    }
    seen.add(name);
    for (const width of widths) {
      if (width !== '' && !CSS_WIDTH.test(width)) {
        throw ohneError({
          title: `Invalid \`dashboard.table.columns\` width \`${width}\``,
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
