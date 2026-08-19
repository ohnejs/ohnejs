import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isDecimalString } from '../../utils/is/is-decimal-string.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isInteger } from '../../utils/is/is-integer.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { useT } from '../runtime/use-t.ts';
import { checkbox } from '../ui/checkbox.ts';
import { labeledField } from '../ui/labeled-field.ts';
import { textInput } from '../ui/text-input.ts';
import { blocksOf } from './_blocks.ts';
import { carriedField, carryValue } from './_items.ts';

/**
 * One composite item's form over its subfields: inputs in, a wire-legal full item out.
 *
 * Scalar and single-relation subfields render as inputs.
 * Deeper composite subfields carry their initial values through, sanitized to what the wire accepts.
 * An item write is always whole, so omitting them would reset them.
 */
export interface ItemForm {
  /**
   * The form's rows, one labeled control per rendered subfield.
   */
  render(): Child;

  /**
   * Parses the form into the full item value, the carried subfields included.
   * The item `UUID` rides along only when the form was created with `attachUUID`.
   * A parse failure marks its rows and yields no value.
   */
  read(): Record<string, unknown> | undefined;

  /**
   * Routes server messages onto the form's rows, keyed by subfield name.
   * Returns the first message that matched no rendered row, or `''` when every message placed.
   */
  setErrors(errors: Readonly<Record<string, string>>): string;

  /**
   * Whether the form currently holds messages on its rows, from a parse failure or a routed `422`.
   * Reads reactively, so a flag rendered from it updates as errors land and clear.
   */
  errored(): boolean;
}

/**
 * Options for `createItemForm`.
 */
export interface ItemFormOptions {
  /**
   * Attaches an existing item's `UUID` to the read value, keeping its row on a list write.
   * The wire accepts item `UUID`s only inside `childMany` lists; a `childOne` write rejects them.
   */
  attachUUID: boolean;
}

css`
  .ohne-item {
    border-top: 1px solid var(--hairline);
    padding-top: 16px;
    margin-top: 16px;
  }

  .ohne-item-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 10px;
  }

  .ohne-item-bar .ohne-caps {
    margin-right: auto;
  }

  .ohne-item-failure {
    min-height: 20px;
    margin: 16px 0 12px;
    font-size: 12px;
    color: var(--danger);
  }

  .ohne-item-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
`;

/**
 * Builds an `ItemForm` over `fields` seeded from `initial`, an existing item or `undefined`.
 * Check `itemFormSupports` first; unsupported subfields make the round trip lossy.
 */
export function createItemForm(
  fields: readonly DashboardField[],
  initial: Readonly<Record<string, unknown>> | undefined,
  options: ItemFormOptions,
): ItemForm {
  const t = useT();
  const blocks = blocksOf();
  const rendered = fields.filter(formField);
  const texts = new Map<string, Ref<string>>();
  const bools = new Map<string, Ref<boolean>>();
  for (const field of rendered) {
    const current = initial?.[field.name];
    if (field.logicalType === 'boolean') bools.set(field.name, ref(current === true));
    else texts.set(field.name, ref(isNullish(current) ? '' : String(current as string | number)));
  }
  const errors = ref<Readonly<Record<string, string>>>(blank());

  return {
    render() {
      const first = rendered.find((field) => field.logicalType !== 'boolean')?.name;
      return rendered.map((field) =>
        labeledField(
          () => (field.required ? `${field.label} *` : field.label),
          control(field, texts.get(field.name), bools.get(field.name), field.name === first),
          () => errors.value[field.name] ?? '',
        ),
      );
    },
    read() {
      const item: Record<string, unknown> = {};
      const invalid = blank();
      for (const field of fields) {
        if (formField(field) || !carriedField(field)) continue;
        const carried = carryValue(field, initial?.[field.name], blocks);
        if (!isUndefined(carried)) item[field.name] = carried;
      }
      for (const field of rendered) {
        const outcome = parseControl(
          field,
          texts.get(field.name),
          bools.get(field.name),
          isNullish(initial?.[field.name]),
          t,
        );
        if (!isUndefined(outcome.error)) invalid[field.name] = outcome.error;
        else if (!isUndefined(outcome.value)) item[field.name] = outcome.value;
      }
      errors.value = invalid;
      if (!isEmpty(invalid)) return undefined;
      const uuid = initial?.UUID;
      if (options.attachUUID && isString(uuid)) item.UUID = uuid;
      return item;
    },
    setErrors(server) {
      errors.value = Object.assign(blank(), server);
      const names = new Set(rendered.map((field) => field.name));
      for (const [key, message] of Object.entries(server)) {
        if (!names.has(key)) return message;
      }
      return '';
    },
    errored() {
      return !isEmpty(errors.value);
    },
  };
}

/**
 * Whether the subfield renders as a form control: writable, mutable scalars and single relations.
 */
function formField(field: DashboardField): boolean {
  if (!field.writable || field.immutable || field.name === 'UUID') return false;
  if (field.kind === 'record') return true;
  return field.kind === 'column' && field.logicalType !== 'json';
}

/**
 * The subfield's control: a checkbox for booleans, a typed text input otherwise.
 */
function control(
  field: DashboardField,
  text: Ref<string> | undefined,
  bool: Ref<boolean> | undefined,
  autofocus: boolean,
): Child {
  if (!isUndefined(bool)) return checkbox(bool);
  if (isUndefined(text)) return null;
  return textInput(text, {
    type: field.type === 'password' ? 'password' : 'text',
    autofocus,
  });
}

/**
 * Parses one control's state into its wire value.
 * An emptied nullable input writes `null`; a non-nullable one yields nothing, so defaults apply.
 * An unchecked box over a stored `null` stays `null`, so an untouched save is a no-op.
 */
function parseControl(
  field: DashboardField,
  text: Ref<string> | undefined,
  bool: Ref<boolean> | undefined,
  initialNullish: boolean,
  t: (key: 'dashboard.invalidInteger' | 'dashboard.invalidNumber') => string,
): { value?: unknown; error?: string } {
  if (!isUndefined(bool)) {
    if (bool.value) return { value: true };
    return { value: field.nullable && initialNullish ? null : false };
  }
  if (isUndefined(text)) return {};
  const raw = text.value.trim();
  if (raw === '') return field.nullable ? { value: null } : {};
  if (field.logicalType === 'integer') {
    if (!isDecimalString(raw) || !isInteger(Number(raw))) {
      return { error: t('dashboard.invalidInteger') };
    }
    return { value: Number(raw) };
  }
  if (field.logicalType === 'real') {
    if (!isDecimalString(raw) || !isRealNumber(Number(raw))) {
      return { error: t('dashboard.invalidNumber') };
    }
    return { value: Number(raw) };
  }
  return { value: text.value };
}

/**
 * The messages under `prefix`, re-keyed without it, for routing a `422` into one item's form.
 */
export function scopedErrors(
  errors: Readonly<Record<string, string>>,
  prefix: string,
): Record<string, string> {
  const scoped = blank();
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(prefix)) scoped[key.slice(prefix.length)] = message;
  }
  return scoped;
}

/**
 * A fresh error map with no prototype, since subfield names may collide with `Object` keys.
 */
function blank(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}
