import type { Child } from '../../render/insert.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { card } from '../../ui/card.ts';
import { switchInput } from '../../ui/switch.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFormSupports } from '../_items.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

css`
  /* The card header carries the field label, so the row's own label above the card hides. */
  .ohne-fieldrow:has(> .ohne-object) > .ohne-field-label .ohne-label {
    display: none;
  }

  /* The hidden label held the auto margin; without it, the meta marks keep the right edge. */
  .ohne-fieldrow:has(> .ohne-object) > .ohne-field-label {
    justify-content: flex-end;
  }

  /* The card header carries the label, so it mirrors the field label's required mark. */
  .ohne-object-required::after {
    content: '*';
    margin-left: 0.125em;
    margin-left: round(0.125em, 1px);
    color: hsl(var(--ohne-destructive));
  }

  .ohne-object-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .ohne-object-toggle {
    flex-shrink: 0;
    width: auto;
  }

  .ohne-object-has-error > .ohne-card {
    border-color: hsl(var(--ohne-destructive));
  }
`;

/**
 * The `object` field's dashboard behaviour, following Pruvious v4's `Object` and `NullableObject`.
 *
 * Cells summarize the child by its first text subfield's value.
 * There is no inline cell editor: the child edits on the record page as a card holding its subform.
 * The card header carries the field label; a non-nullable child always renders its subform.
 * A nullable child toggles through the header switch, which keeps the discarded values for re-enable.
 * An object-level error paints the card border destructive, with the message under the card.
 * The child writes whole with the record's one save.
 */
export const objectType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      if (!isPlainObject<Record<string, unknown>>(current)) return dimMark('{…}');
      const summary = summaryOf(current, field.subfields ?? []);
      return summary === '' ? dimMark('{…}') : summary;
    };
  },
  control(context) {
    const subfields = context.field.subfields ?? [];
    if (!itemFormSupports(subfields, blocksOf())) return undefined;
    const t = useT();
    const off = context.disabled === true;

    let base = context.initial;
    // Later forms are built from event handlers where no scope is active; the owner catches them,
    // so the record surface's teardown releases their effects too.
    const owner = effectScope();
    const baseObject = (): Record<string, unknown> | undefined =>
      isPlainObject<Record<string, unknown>>(base) ? base : undefined;

    const formOf = (item: Readonly<Record<string, unknown>> | undefined): FieldForm =>
      owner.run(() =>
        createFieldForm(subfields, item, {
          mode: context.mode,
          path: context.path,
          disabled: off,
          language: context.language,
          onInput: context.onInput,
        }),
      );

    // `seed` is what the current form was built from; base identity marks the pristine base form.
    // `stash` keeps the values a toggle-off discarded, restored on the next toggle-on, as the source
    // preserves its `objectValue` across the switch.
    let seed: Record<string, unknown> | undefined;
    let stash: Record<string, unknown> | undefined;

    const buildForm = (item: Record<string, unknown> | undefined): FieldForm => {
      seed = item;
      return formOf(item);
    };
    const { field } = context;
    // A nullable child rests unset; a non-nullable one always holds a form, exactly as the source
    // splits `nullableObject` and `object`.
    const baseForm = (): FieldForm | null => {
      const stored = baseObject();
      if (!field.nullable) return buildForm(stored);
      seed = undefined;
      return isUndefined(stored) ? null : buildForm(stored);
    };

    const entry = ref<FieldForm | null>(baseForm());
    const touched = ref(false);
    const routed = ref('');

    const valueOf = (form: FieldForm): Record<string, unknown> => {
      const value = form.read().value;
      return isPlainObject<Record<string, unknown>>(value) ? value : {};
    };

    const setForm = (next: FieldForm | null): void => {
      entry.value?.dispose();
      entry.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const toggleModel: Ref<boolean> = {
      get value() {
        return !isNull(entry.value);
      },
      set value(next: boolean) {
        const form = entry.value;
        if (next === !isNull(form)) return;
        if (isNull(form)) {
          setForm(buildForm(stash ?? baseObject()));
          return;
        }
        // A pristine base form stashes the base itself, so toggling back reads clean.
        const pristine = seed === baseObject() && !isUndefined(seed) && !form.dirty();
        stash = pristine ? baseObject() : valueOf(form);
        seed = undefined;
        setForm(null);
      },
    };

    const label = (): HTMLElement =>
      h(
        'span',
        {
          class: `ohne-block ohne-medium ohne-truncate${
            field.required ? ' ohne-object-required' : ''
          }`,
        },
        field.label,
      );

    // Built once and re-parented across card rebuilds, so a click never unmounts the focused knob.
    const toggle = field.nullable
      ? switchInput(toggleModel, undefined, { disabled: off ? (): boolean => true : undefined })
      : null;
    if (!isNull(toggle)) {
      toggle.classList.add('ohne-object-toggle');
      const knob = toggle.querySelector('button') as HTMLElement;
      effect(() => {
        const caption = t(isNull(entry.value) ? 'dashboard.enable' : 'dashboard.disable');
        knob.title = caption;
        knob.setAttribute('aria-label', caption);
      });
    }

    const header = (): Child =>
      isNull(toggle) ? label() : h('div', { class: 'ohne-object-header' }, label(), toggle);

    const element = h(
      'div',
      { class: () => `ohne-object${routed.value === '' ? '' : ' ohne-object-has-error'}` },
      () => {
        const form = entry.value;
        return card(
          isNull(form)
            ? undefined
            : subfields.length === 0
              ? h('span', { class: 'ohne-muted' }, () => t('dashboard.noFieldsToDisplay'))
              : form.render(),
          { header: header() },
        );
      },
    );

    return {
      element,
      read() {
        const form = entry.value;
        if (isNull(form)) {
          if (!touched.value && isUndefined(base)) return {};
          return { value: null };
        }
        if (!touched.value && isUndefined(base) && !form.dirty()) return {};
        return form.read();
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        const rest = withoutRoot(errors);
        const form = entry.value;
        if (isNull(form)) return firstMessage(rest);
        return form.setErrors(rest);
      },
      error: () => routed.value,
      errored: () => entry.value?.errored() === true,
      dirty: () => {
        const form = entry.value;
        const stored = baseObject();
        if (isNull(form)) return !isUndefined(stored);
        if (field.nullable && isUndefined(stored)) return true;
        return seed === stored ? form.dirty() : true;
      },
      focus() {
        const form = entry.value;
        if (!isNull(form) && !form.focusError()) form.focus();
      },
      revert() {
        entry.value?.dispose();
        entry.value = baseForm();
        stash = undefined;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        stash = undefined;
        const form = entry.value;
        // A present child rebases in place, keeping its controls and their focus.
        if (!isNull(form) && isPlainObject<Record<string, unknown>>(value)) {
          form.rebase(value);
          seed = baseObject();
        } else {
          entry.value?.dispose();
          entry.value = baseForm();
        }
        touched.value = false;
        routed.value = '';
      },
    };
  },
};

/**
 * The child's first non-empty text subfield value, for the cell summary.
 */
function summaryOf(
  item: Readonly<Record<string, unknown>>,
  subfields: readonly DashboardField[],
): string {
  for (const field of subfields) {
    if (field.logicalType !== 'text' || field.type === 'password') continue;
    const value = item[field.name];
    if (isString(value) && value !== '') return value;
  }
  return '';
}

/**
 * `errors` without the control's own `''` key.
 */
function withoutRoot(errors: Readonly<Record<string, string>>): Record<string, string> {
  const rest = Object.create(null) as Record<string, string>;
  for (const [key, message] of Object.entries(errors)) {
    if (key !== '') rest[key] = message;
  }
  return rest;
}

/**
 * The first message in the map, or `''`.
 */
function firstMessage(errors: Readonly<Record<string, string>>): string {
  for (const message of Object.values(errors)) return message;
  return '';
}

registerFieldType('object', objectType);
