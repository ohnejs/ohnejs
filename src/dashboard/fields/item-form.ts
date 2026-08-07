import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isDecimalString } from '../../utils/is/is-decimal-string.ts';
import { isInteger } from '../../utils/is/is-integer.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { useT } from '../runtime/use-t.ts';
import { checkbox } from '../ui/checkbox.ts';
import { labeledField } from '../ui/labeled-field.ts';
import { textInput } from '../ui/text-input.ts';

/**
 * One composite item's form over its subfields: inputs in, a wire-legal full item out.
 *
 * Scalar and single-relation subfields render as inputs.
 * Deeper composite subfields carry their initial values through, sanitized to what the wire
 * accepts, since an item write is always whole and omitting them would reset them.
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
 * Whether an `ItemForm` can round-trip items over `fields` without losing or corrupting data.
 * `blocks` subfields have no served metadata to sanitize by, and a write-only subfield's value
 * can neither render nor carry - both refuse, at any nesting depth.
 */
export function itemFormSupports(fields: readonly DashboardField[]): boolean {
  return fields.every((field) => {
    if (field.name === 'UUID') return true;
    if (field.kind === 'blocks') return false;
    if (!field.readable) return false;
    if (isUndefined(field.subfields)) return true;
    return itemFormSupports(field.subfields);
  });
}

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
        const carried = carryValue(field, initial?.[field.name]);
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
      if (Object.keys(invalid).length > 0) return undefined;
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
 * Whether the subfield's initial value carries into the write: writable, mutable, not rendered.
 */
function carriedField(field: DashboardField): boolean {
  return field.writable && !field.immutable && field.name !== 'UUID';
}

/**
 * The carried value, sanitized to what the wire accepts at the subfield's kind.
 * Child items shed rejected keys recursively; only `childMany` items keep their `UUID`s.
 */
function carryValue(field: DashboardField, value: unknown): unknown {
  if (isUndefined(value)) return undefined;
  if (field.kind === 'childOne') {
    if (!isPlainObject<Record<string, unknown>>(value)) return null;
    return sanitizeItem(field.subfields ?? [], value, false);
  }
  if (field.kind === 'childMany') {
    if (!isArray(value)) return [];
    return value
      .filter((item) => isPlainObject<Record<string, unknown>>(item))
      .map((item) => sanitizeItem(field.subfields ?? [], item, true));
  }
  return value;
}

/**
 * One carried item, rebuilt from its metadata so only wire-accepted keys survive.
 */
function sanitizeItem(
  fields: readonly DashboardField[],
  item: Readonly<Record<string, unknown>>,
  attachUUID: boolean,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const field of fields) {
    if (!carriedField(field)) continue;
    const carried = carryValue(field, item[field.name]);
    if (!isUndefined(carried)) clean[field.name] = carried;
  }
  if (attachUUID && isString(item.UUID)) clean.UUID = item.UUID;
  return clean;
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
