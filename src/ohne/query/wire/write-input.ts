import type { FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';

import { isArray, isEmpty, isPlainObject, isString, isUndefined } from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';
import { validationError } from '../write/errors.ts';

/**
 * Validates an untrusted write input's keys against a collection's fields.
 *
 * The wire's half of the flag contract: the generated input types already drop flagged fields.
 * A typed caller cannot name them; this guards the HTTP ingress, where no types exist.
 * A key is denied when it is unknown, `writable: false`, or - on update - `immutable: true`.
 * Each denied key collects `validation.unknownField` at its dot path, one indistinguishable shape.
 * A response therefore never reveals that a hidden field exists.
 * The walk descends composite items and block envelopes, mirroring the pipeline's own key rule.
 * A field is settable when it carries a `fieldType`, and an item `UUID` is legal on update alone.
 * Value shapes stay the pipeline's job: a value that does not match its field's shape is not descended.
 * Every denied path collects before the throw; a failure throws a `ValidationError` rendered as `422`.
 */
export function checkWriteInput(
  input: Record<string, unknown>,
  fields: Record<string, FieldQueryMeta>,
  operation: 'create' | 'update',
): void {
  const errors: FieldErrors = {};
  walkInput(input, fields, operation, '', errors, false);
  if (!isEmpty(errors)) throw validationError(errors);
}

/**
 * Collects the denied paths of one scope, recursing wherever a value plausibly nests a child scope.
 * `items` marks a repeater item scope, where an update input names its row by `UUID`.
 */
function walkInput(
  input: Record<string, unknown>,
  fields: Record<string, FieldQueryMeta>,
  operation: 'create' | 'update',
  prefix: string,
  errors: FieldErrors,
  items: boolean,
): void {
  for (const [name, value] of Object.entries(input)) {
    if (items && operation === 'update' && name === 'UUID') continue;
    const path = prefix === '' ? name : `${prefix}.${name}`;
    const field = fields[name];
    if (
      isUndefined(field) ||
      isUndefined(field.fieldType) ||
      field.writable === false ||
      (operation === 'update' && field.immutable === true)
    ) {
      errors[path] = 'validation.unknownField';
      continue;
    }
    const subfields = field.subfields as Record<string, FieldQueryMeta>;
    if (field.kind === 'childOne' && isPlainObject(value)) {
      walkInput(value, subfields, operation, path, errors, false);
    }
    if (field.kind === 'childMany' && isArray(value)) {
      value.forEach((item, index) => {
        if (isPlainObject(item)) {
          walkInput(item, subfields, operation, `${path}[${index}]`, errors, true);
        }
      });
    }
    if (field.kind === 'blocks' && isArray(value)) {
      value.forEach((item, index) => {
        if (!isPlainObject(item) || !isString(item.block)) return;
        if (!(field.allow as readonly string[]).includes(item.block)) return;
        if (!isPlainObject(item.fields)) return;
        const block = blockQueryMetadata(item.block).fields;
        walkInput(item.fields, block, operation, `${path}[${index}].fields`, errors, false);
      });
    }
  }
}
