import type { FieldInstance } from '../fields/field.ts';
import type { BlockDefinition } from './define-block.ts';

import { didYouMean, isPlainObject, isString, isUndefined } from '../../utils/index.ts';
import { validateIcon } from '../dashboard/validate-icon.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { validateLayout } from '../fields/layout.ts';

const DASHBOARD_KEYS = new Set(['icon', 'titleField', 'layout']);

/**
 * Validates a block definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - `block` is also reserved: the discriminator beside a block's fields in reads, writes, and `has` scopes.
 * - `dashboard` must be an object holding only `icon`, `titleField`, and `layout`.
 * - `dashboard.icon` names a carried icon, or maps a declared field's values to carried icons.
 * - `dashboard.titleField` and `layout` name declared fields.
 * - A known block name sharpens the messages; omit it before the name is known.
 */
export function validateBlockDefinition<TFields extends Record<string, FieldInstance>>(
  definition: BlockDefinition<TFields>,
  block?: string,
): void {
  const fieldNames = Object.keys(definition.fields);
  for (const name of fieldNames) {
    validateFieldName(name, block);
    if (name.toLowerCase() !== 'block') continue;
    const where = isUndefined(block) ? '' : ` in \`${block}\``;
    throw ohneError({
      title: `Field name \`${name}\` is reserved`,
      body: [
        "`block` is the discriminator key beside a block's own fields, so no field may claim it.",
        `Rename it${where}.`,
      ],
    });
  }
  validateUniqueNames(fieldNames, 'field', block);
  validateDashboard(definition.dashboard, fieldNames, block);
}

/**
 * Rejects a malformed `dashboard` declaration: a non-object value or an unknown key.
 */
function validateDashboard(
  dashboard: unknown,
  fieldNames: readonly string[],
  block?: string,
): void {
  if (isUndefined(dashboard)) return;
  const scope = isUndefined(block) ? '' : ` in block \`${block}\``;
  if (!isPlainObject(dashboard)) {
    throw ohneError({
      title: 'Invalid `dashboard` declaration',
      body: [
        `The \`dashboard\` option${scope} must be an object.`,
        "Write `dashboard: { layout: [{ row: ['title', 'subtitle'] }] }`.",
      ],
    });
  }
  for (const key of Object.keys(dashboard)) {
    if (DASHBOARD_KEYS.has(key)) continue;
    throw ohneError({
      title: `Unknown \`dashboard\` key \`${key}\``,
      body: [
        `The \`dashboard\` option${scope} names \`${key}\`.`,
        'The keys are `icon`, `titleField`, and `layout`.',
      ],
    });
  }
  validateBlockIcon(dashboard.icon, fieldNames, scope);
  validateFieldOption(dashboard.titleField, 'dashboard.titleField', fieldNames, scope);
  validateLayout(dashboard.layout, fieldNames, 'dashboard.layout', scope);
}

/**
 * Rejects a `dashboard.icon` that is neither a carried icon nor a map from a declared field's values.
 */
function validateBlockIcon(icon: unknown, fieldNames: readonly string[], scope: string): void {
  if (!isPlainObject(icon)) {
    validateIcon(icon, 'dashboard.icon', scope);
    return;
  }
  validateFieldOption(icon.field, 'dashboard.icon.field', fieldNames, scope);
  if (!isPlainObject(icon.map)) {
    throw ohneError({
      title: 'Invalid `dashboard.icon.map` declaration',
      body: [
        `The \`dashboard.icon.map\` option${scope} must map field values to icon names.`,
        "Write `icon: { field: 'columns', map: { '2': 'columns-2', '3': 'columns-3' } }`.",
      ],
    });
  }
  for (const name of Object.values(icon.map)) validateIcon(name, 'dashboard.icon.map', scope);
  validateIcon(icon.default, 'dashboard.icon.default', scope);
}

/**
 * Rejects an option that must name one of the block's declared fields.
 */
function validateFieldOption(
  value: unknown,
  option: string,
  fieldNames: readonly string[],
  scope: string,
): void {
  if (isUndefined(value) || (isString(value) && fieldNames.includes(value))) return;
  const near = isString(value) ? didYouMean(value, fieldNames) : undefined;
  throw ohneError({
    title: `Invalid \`${option}\` declaration`,
    body: [
      `The \`${option}\` option${scope} must name one of the block's fields.`,
      isUndefined(near) ? fieldList(fieldNames) : `Did you mean \`${near}\`?`,
    ],
  });
}

/**
 * The block's fields as one body row, or a note that it declares none.
 */
function fieldList(fieldNames: readonly string[]): string {
  if (fieldNames.length === 0) return 'The block declares no fields.';
  return `The fields are ${fieldNames.map((name) => `\`${name}\``).join(', ')}.`;
}
