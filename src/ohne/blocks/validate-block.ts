import type { FieldInstance } from '../fields/field.ts';
import type { BlockDefinition } from './define-block.ts';

import { isPlainObject, isUndefined } from '../../utils/index.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';
import { validateLayout } from '../fields/layout.ts';

const DASHBOARD_KEYS = new Set(['layout']);

/**
 * Validates a block definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - `block` is also reserved: the discriminator beside a block's fields in reads, writes, and `has` scopes.
 * - `dashboard` must be an object holding only `layout`, naming declared fields in the node grammar.
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
      body: [`The \`dashboard\` option${scope} names \`${key}\`.`, 'The only key is `layout`.'],
    });
  }
  validateLayout(dashboard.layout, fieldNames, 'dashboard.layout', scope);
}
