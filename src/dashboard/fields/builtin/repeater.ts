import type { DashboardField } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFormSupports } from '../_items.ts';
import { createFieldForm } from '../field-form.ts';
import {
  dimMark,
  type FieldControlContext,
  type FieldType,
  registerFieldType,
} from '../field-type.ts';

/**
 * One list row: a stable local key and the item's form.
 */
interface RepeaterEntry {
  key: number;
  form: FieldForm;
}

css`
  .ohne-itemcard {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s3) var(--s4) var(--s4);
  }

  .ohne-itemcard + .ohne-itemcard {
    margin-top: var(--s3);
  }

  .ohne-itemcard-bar {
    display: flex;
    align-items: center;
    gap: var(--s1);
    margin-bottom: var(--s2);
  }

  .ohne-itemcard-bar .ohne-caps {
    margin-right: auto;
  }

  .ohne-itemcard-add {
    margin-top: var(--s3);
  }
`;

/**
 * The `repeater` field's dashboard behaviour.
 *
 * Cells show a dim item count.
 * There is no inline cell editor: the list edits on the record page as expanded item cards.
 * The cards add, remove, and reorder; kept items ride their `UUID`.
 * The record's one save writes the list whole.
 */
export const repeaterType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      const length = isArray(current) ? current.length : 0;
      return dimMark(length === 0 ? '·' : `${length} ×`);
    };
  },
  control(context) {
    const subfields = context.field.subfields ?? [];
    if (subfields.length === 0 || !itemFormSupports(subfields, blocksOf())) return undefined;
    const t = useT();

    let base = context.initial;
    let nextKey = 0;
    // Later items are built from event handlers where no scope is active; the owner catches them,
    // so the record surface's teardown releases their effects too.
    const owner = effectScope();
    const entryOf = (item: Readonly<Record<string, unknown>> | undefined): RepeaterEntry => {
      const key = (nextKey += 1);
      return { key, form: owner.run(() => itemForm(context, subfields, item, key)) };
    };
    const baseEntries = (): RepeaterEntry[] =>
      (isArray(base) ? base : [])
        .filter((item) => isPlainObject<Record<string, unknown>>(item))
        .map(entryOf);

    const entries = ref<readonly RepeaterEntry[]>(baseEntries());
    const touched = ref(false);
    const routed = ref('');

    const baseItems = (): Readonly<Record<string, unknown>>[] =>
      (isArray(base) ? base : []).filter((item) => isPlainObject<Record<string, unknown>>(item));

    const rebuild = (): void => {
      for (const entry of entries.value) entry.form.dispose();
      entries.value = baseEntries();
    };

    const change = (next: readonly RepeaterEntry[]): void => {
      entries.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const move = (key: number, delta: -1 | 1): void => {
      const list = [...entries.value];
      const from = list.findIndex((entry) => entry.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [entry] = list.splice(from, 1);
      list.splice(to, 0, entry as RepeaterEntry);
      change(list);
    };

    const element = h(
      'div',
      { tabindex: '-1' },
      each(
        () => entries.value,
        (entry) => entry.key,
        (entry, index) =>
          h(
            'div',
            { class: 'ohne-itemcard' },
            h(
              'div',
              { class: 'ohne-itemcard-bar' },
              h('span', { class: 'ohne-caps' }, () => String(index() + 1)),
              button('↑', {
                variant: 'ghost',
                disabled: () => index() === 0,
                onClick: () => move(entry().key, -1),
              }),
              button('↓', {
                variant: 'ghost',
                disabled: () => index() === entries.value.length - 1,
                onClick: () => move(entry().key, 1),
              }),
              button('✕', {
                variant: 'ghost',
                ariaLabel: t('dashboard.removeItem'),
                onClick: () => {
                  entry().form.dispose();
                  change(entries.value.filter((live) => live.key !== entry().key));
                },
              }),
            ),
            entry().form.render(),
          ),
      ),
      h(
        'div',
        { class: 'ohne-itemcard-add' },
        button(() => `+ ${t('dashboard.addItem')}`, {
          variant: 'ghost',
          onClick: () => {
            const entry = entryOf(undefined);
            change([...entries.value, entry]);
            queueMicrotask(() => entry.form.focus());
          },
        }),
      ),
    );

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base) && !entries.value.some((e) => e.form.dirty())) {
          return {};
        }
        const errors = blank();
        const items: Record<string, unknown>[] = [];
        entries.value.forEach((entry, index) => {
          const reading = entry.form.read();
          if (!isUndefined(reading.errors)) {
            for (const [key, message] of Object.entries(reading.errors)) {
              errors[`[${index}]${key.startsWith('[') ? key : `.${key}`}`] = message;
            }
          } else if (isPlainObject<Record<string, unknown>>(reading.value)) {
            items.push(reading.value);
          }
        });
        if (Object.keys(errors).length > 0) return { errors };
        return { value: items };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        let unplaced = '';
        const grouped = new Map<number, Record<string, string>>();
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]\.?/.exec(key);
          if (isNull(match)) {
            if (unplaced === '') unplaced = message;
            continue;
          }
          const index = Number(match[1]);
          const scoped = grouped.get(index) ?? blank();
          scoped[key.slice(match[0].length)] = message;
          grouped.set(index, scoped);
        }
        entries.value.forEach((entry, index) => {
          const leftover = entry.form.setErrors(grouped.get(index) ?? blank());
          if (leftover !== '' && unplaced === '') unplaced = leftover;
        });
        return unplaced;
      },
      error: () => routed.value,
      errored: () => entries.value.some((entry) => entry.form.errored()),
      dirty: () => touched.value || entries.value.some((entry) => entry.form.dirty()),
      focus() {
        const errored = entries.value.find((entry) => entry.form.errored());
        if (!isUndefined(errored)) {
          errored.form.focusError();
          return;
        }
        entries.value[0]?.form.focus();
      },
      revert() {
        rebuild();
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        const items = baseItems();
        // A matching answer rebases each item's form in place, keeping controls and their focus;
        // fresh items pick up the `UUID` the server minted through their new seed.
        if (items.length === entries.value.length) {
          entries.value.forEach((entry, index) => entry.form.rebase(items[index]));
        } else {
          rebuild();
        }
        touched.value = false;
        routed.value = '';
      },
    };
  },
};

/**
 * One item's form, its ids keyed by the entry's local key so reordered rows never collide.
 */
function itemForm(
  context: FieldControlContext,
  subfields: readonly DashboardField[],
  item: Readonly<Record<string, unknown>> | undefined,
  key: number,
): FieldForm {
  return createFieldForm(subfields, item, {
    mode: context.mode,
    path: `${context.path}[${key}]`,
    attachUUID: true,
    language: context.language,
    onInput: context.onInput,
  });
}

/**
 * A fresh error map with no prototype, since subfield names may collide with `Object` keys.
 */
function blank(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

registerFieldType('repeater', repeaterType);
