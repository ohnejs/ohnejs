import type { FieldType } from './define-field.ts';
import type { FieldTypeName } from './known-fields.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';
import { blocks } from './builtin/blocks.ts';
import { boolean } from './builtin/boolean.ts';
import { dateTime } from './builtin/date-time.ts';
import { date } from './builtin/date.ts';
import { integer } from './builtin/integer.ts';
import { multiSelect } from './builtin/multi-select.ts';
import { number } from './builtin/number.ts';
import { object } from './builtin/object.ts';
import { record } from './builtin/record.ts';
import { records } from './builtin/records.ts';
import { repeater } from './builtin/repeater.ts';
import { select } from './builtin/select.ts';
import { text } from './builtin/text.ts';
import { time } from './builtin/time.ts';

/**
 * One registered field type: its name and its definition.
 */
export interface FieldTypeMeta {
  /**
   * The name the type is registered and referenced under.
   */
  name: FieldTypeName;

  /**
   * The field-type definition.
   */
  fieldType: FieldType;
}

const registry: Registry<FieldTypeMeta> = createRegistry<FieldTypeMeta>();

for (const [name, fieldType] of [
  ['text', text],
  ['integer', integer],
  ['number', number],
  ['boolean', boolean],
  ['select', select],
  ['multiSelect', multiSelect],
  ['date', date],
  ['time', time],
  ['dateTime', dateTime],
  ['record', record],
  ['records', records],
  ['object', object],
  ['repeater', repeater],
  ['blocks', blocks],
] as const) {
  registry.register(name, { name, fieldType });
}

/**
 * Returns the process-wide field-type registry, keyed by field-type name.
 *
 * ohne's built-in types are registered here, so a field resolves even with the ohne layer opted out.
 * Codegen registers each layer's own types on top.
 * A name that already exists is overridden, so a field type from a closer layer wins.
 *
 * @example
 * ```ts
 * useFields().get('text')
 * // -> { name: 'text', fieldType: { columnType: 'text', ... } }
 * ```
 */
export function useFields(): Registry<FieldTypeMeta> {
  return registry;
}
