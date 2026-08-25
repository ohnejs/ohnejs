import type { Child } from '../../render/insert.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { card } from '../../ui/card.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFormSupports } from '../_items.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

css`
  /* The card header carries the field label, so the row's own label above the card hides. */
  .ohne-fieldrow:has(> .ohne-object) > .ohne-fieldrow-head > .ohne-fieldrow-label {
    display: none;
  }

  .ohne-object-has-error > .ohne-card {
    border-color: hsl(var(--ohne-destructive));
  }
`;

/**
 * The `object` field's dashboard behaviour.
 *
 * Cells summarize the child by its first text subfield's value.
 * There is no inline cell editor: the child edits on the record page as a card holding its subform.
 * The card header carries the field label; an unset child renders the header alone with a set action.
 * An object-level error paints the card border destructive, with the message under the card.
 * The child clears and re-sets in place, and writes whole with the record's one save.
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

    let base = context.initial;
    // Later forms are built from event handlers where no scope is active; the owner catches them,
    // so the record surface's teardown releases their effects too.
    const owner = effectScope();
    const formOf = (item: Readonly<Record<string, unknown>> | undefined): FieldForm =>
      owner.run(() =>
        createFieldForm(subfields, item, {
          mode: context.mode,
          path: context.path,
          language: context.language,
          onInput: context.onInput,
        }),
      );
    const baseForm = (): FieldForm | null =>
      isPlainObject<Record<string, unknown>>(base) ? formOf(base) : null;

    const entry = ref<FieldForm | null>(baseForm());
    const touched = ref(false);
    const routed = ref('');

    const swap = (next: FieldForm | null): void => {
      entry.value?.dispose();
      entry.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const { field } = context;
    const label = (): HTMLElement =>
      h(
        'span',
        { class: 'ohne-block ohne-medium ohne-truncate' },
        field.required ? `${field.label} *` : field.label,
      );
    const header = (form: FieldForm | null): Child => {
      if (isNull(form)) {
        return h(
          'div',
          { class: 'ohne-justify-between' },
          label(),
          button(() => `+ ${t('dashboard.set')}`, {
            variant: 'ghost',
            onClick: () => swap(formOf(undefined)),
          }),
        );
      }
      if (field.nullable) {
        return h(
          'div',
          { class: 'ohne-justify-between' },
          label(),
          button(() => t('dashboard.clear'), { variant: 'ghost', onClick: () => swap(null) }),
        );
      }
      return label();
    };

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
          { header: header(form) },
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
      dirty: () => touched.value || entry.value?.dirty() === true,
      focus() {
        const form = entry.value;
        if (!isNull(form) && !form.focusError()) form.focus();
      },
      revert() {
        entry.value?.dispose();
        entry.value = baseForm();
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        const form = entry.value;
        // A present child rebases in place, keeping its controls and their focus.
        if (!isNull(form) && isPlainObject<Record<string, unknown>>(value)) form.rebase(value);
        else {
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
