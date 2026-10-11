import type { FieldLayout } from '../../utils/field-layout/field-layout.ts';
import type { DashboardField } from '../runtime/meta-types.ts';
import type { Text } from '../runtime/text-type.ts';
import type { ExpandableDescription, FieldSpec, FieldSpecs } from './known-field-types.ts';

import { toSentenceCase } from '../../utils/case/to-sentence-case.ts';
import { resolveLayoutNodes } from '../../utils/field-layout/resolve-layout-nodes.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { hasKey } from '../../utils/object/has-key.ts';

/**
 * How each composite or relation type stores, as the server describes it; every other type is a column.
 */
const KINDS: Readonly<Record<string, DashboardField['kind']>> = {
  record: 'record',
  records: 'records',
  object: 'childOne',
  repeater: 'childMany',
};

/**
 * The list types, which land `[]` when a create omits them, unless their options forbid it.
 */
const LISTS: ReadonlySet<string> = new Set(['multiSelect', 'records', 'repeater']);

/**
 * Describes a page form's `field` spec as the server describes a collection field, so one form renders both.
 * A spec is required unless `nullable`, `default`, `when`, or an empty value fills it without input.
 * `collection` becomes `target`, nested `fields` become `subfields`, and `layout` resolves against them.
 * Every other type option, `default` included, rides in `options`.
 * A spec without a default starts from its empty value, so it never reads absent: see `emptyValue`.
 * `label` stands in for an omitted label; it defaults to the name sentence-cased.
 */
export function specField(
  name: string,
  spec: FieldSpec,
  label: Text = toSentenceCase(name),
): DashboardField {
  const declared = spec.options as Record<string, unknown>;
  const {
    label: own,
    description,
    placeholder,
    nullable,
    when,
    collection,
    fields,
    layout,
    ...rest
  } = declared;
  const field: DashboardField = {
    name,
    type: spec.type,
    kind: KINDS[spec.type] ?? 'column',
    label: (own as Text | undefined) ?? label,
    nullable: nullable === true,
    required:
      nullable !== true &&
      !hasKey(declared, 'default') &&
      isUndefined(when) &&
      isUndefined(emptyValue(spec.type, false, declared)),
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
  };
  if (!isUndefined(when)) field.when = when as DashboardField['when'];
  if (isPlainObject(description) && hasKey(description, 'text')) {
    const { text, showLabel, hideLabel, expanded } = description as ExpandableDescription;
    field.expandable = {
      text,
      showLabel: showLabel ?? 'dashboard.field.showDescription',
      hideLabel: hideLabel ?? 'dashboard.field.hideDescription',
      expanded: expanded ?? false,
    };
  } else if (!isUndefined(description)) {
    field.description = description as Text;
  }
  if (!isUndefined(placeholder)) field.placeholder = placeholder as Text;
  if (!hasKey(rest, 'default')) {
    const empty = emptyValue(spec.type, nullable === true, rest);
    if (!isUndefined(empty)) rest.default = empty;
  }
  if (!isEmpty(rest)) field.options = rest;
  if (!isUndefined(collection)) field.target = collection as string;
  if (isPlainObject<FieldSpecs>(fields)) {
    const subfields = Object.entries(fields).map(([key, sub]) => specField(key, sub));
    field.subfields = subfields;
    if (!isUndefined(layout)) {
      const names = new Set(subfields.map((sub) => sub.name));
      const nodes = resolveLayoutNodes(layout as FieldLayout<string, Text>, names);
      if (!isEmpty(nodes)) field.layout = nodes;
    }
  }
  return field;
}

/**
 * The value a spec of `type` starts from without a default: `null` when nullable, else its empty value.
 * The empty value is `[]` for a list, `{}` for an `object`, and `''` for a text, each where it is allowed.
 * A list allows it unless `allowEmpty` is `false` or `min` is at least 1, as the server rules.
 * A text allows it only under `allowEmpty: true` without a positive `min`.
 */
function emptyValue(
  type: string,
  nullable: boolean,
  options: Readonly<Record<string, unknown>>,
): unknown {
  if (nullable) return null;
  const { allowEmpty, min } = options;
  if (LISTS.has(type)) return allowEmpty === false || (isNumber(min) && min >= 1) ? undefined : [];
  if (type === 'object') return {};
  if (type === 'text' && allowEmpty === true && !(isNumber(min) && min > 0)) return '';
  return undefined;
}
