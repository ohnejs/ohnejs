import type { Child } from '../../render/insert.ts';
import type { FieldForm } from '../field-form.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
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
import { summaryParts, summarySpan, summaryTitle } from '../_summary.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

css`
  /* Floated so the header's ellipsis trims the label text rather than the mark. */
  .ohne-object-required::before {
    content: '*';
    float: right;
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

  .ohne-object-marks {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 1em;
    margin-left: auto;
  }

  .ohne-object-marks .ohne-fieldrow-meta {
    display: flex;
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
 * The `object` field's dashboard behaviour.
 *
 * Cells join the child's values into a one-line digest, nested children flattened in field order.
 * The cell title lists every carried value as a `label: value` row.
 * There is no inline cell editor: the child edits on the record page as a card holding its subform.
 * The card header carries the field label and the row's marks.
 * A non-nullable child always renders its subform.
 * A nullable child toggles through the header switch, which keeps the discarded values for re-enable.
 * An object-level error paints the card border destructive, with the message under the card.
 * The child writes whole with the record's one save.
 */
export const objectType: FieldType = {
  display({ field, value }) {
    const t = useT();
    const subfields = field.subfields ?? [];
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      if (!isPlainObject<Record<string, unknown>>(current)) return dimMark('{…}');
      const parts = summaryParts(current, subfields);
      const title = summaryTitle(current, subfields, t);
      if (parts.length === 0) {
        if (title === '') return dimMark('{…}');
        return h('span', { class: 'cell-dim', title }, '{…}');
      }
      return summarySpan(parts, title);
    };
  },
  control(context) {
    const subfields = context.field.subfields ?? [];
    if (!itemFormSupports(subfields, blocksOf())) return undefined;
    const t = useT();
    const off = context.disabled === true;

    let base = context.initial;
    // Later forms build outside any active scope; the owner keeps their effects in the teardown.
    const owner = effectScope();
    const baseObject = (): Record<string, unknown> | undefined =>
      isPlainObject<Record<string, unknown>>(base) ? base : undefined;

    const formOf = (item: Readonly<Record<string, unknown>> | undefined): FieldForm =>
      owner.run(() =>
        createFieldForm(subfields, item, {
          mode: context.mode,
          path: context.path,
          disabled: off,
          layout: context.field.layout,
          language: context.language,
          onInput: context.onInput,
        }),
      );

    // `seed` is the object the current form was built from; identity with the base marks it pristine.
    let seed: Record<string, unknown> | undefined;
    let stash: Record<string, unknown> | undefined;

    const buildForm = (item: Record<string, unknown> | undefined): FieldForm => {
      seed = item;
      return formOf(item);
    };
    const { field } = context;
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

    // Built once like the toggle, so a card rebuild keeps the marks and their tooltips.
    const marks = h('span', { class: 'ohne-object-marks' });

    const header = (): Child => h('div', { class: 'ohne-object-header' }, label(), marks, toggle);

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
      marks,
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
        // Rebasing in place keeps the child's controls and their focus.
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
