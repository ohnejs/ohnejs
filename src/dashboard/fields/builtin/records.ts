import { isArray } from '../../../utils/is/is-array.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { labelFieldOf, targetOf } from '../_search.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { labelOf } from '../labels.ts';
import { recordSelect } from '../record-select.ts';

css`
  .ohne-links-row {
    display: flex;
    align-items: center;
    gap: var(--s1);
    height: 28px;
    border-bottom: 1px solid var(--line);
  }

  .ohne-links-index {
    width: 18px;
    flex: none;
  }

  .ohne-links-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-links-add {
    margin-top: var(--s2);
  }
`;

/**
 * The `records` field's dashboard behaviour.
 *
 * Cells summarize the ordered links as the first record's label plus a dim `+n` tail.
 * There is no inline cell editor: the list edits on the record page.
 * The form control lists every link with reorder and remove; a stay-open combobox appends link after link.
 */
export const recordsType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      const links = isArray(current) ? current.filter(isString) : [];
      if (links.length === 0) return dimMark('·');
      const first = links[0] as string;
      const resolved = labelOf(field.target ?? '', first);
      return [
        isUndefined(resolved)
          ? h('span', { class: 'cell-mono cell-dim' }, first.slice(0, 8))
          : resolved,
        links.length > 1 ? dimMark(` +${links.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const target = targetOf(context.field);
    if (isUndefined(target)) return undefined;
    if (isUndefined(labelFieldOf(target))) return undefined;
    const t = useT();

    let base = listOf(context.initial);
    const links = ref<readonly string[]>(base);
    const touched = ref(false);
    const routed = ref('');

    const change = (next: readonly string[]): void => {
      links.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const move = (uuid: string, delta: -1 | 1): void => {
      const list = [...links.value];
      const from = list.indexOf(uuid);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [link] = list.splice(from, 1);
      list.splice(to, 0, link as string);
      change(list);
    };

    const element = h(
      'div',
      { class: 'ohne-links', tabindex: '-1' },
      each(
        () => links.value,
        (link) => link,
        (link, index) =>
          h(
            'div',
            { class: 'ohne-links-row' },
            h('span', { class: 'ohne-caps ohne-links-index' }, () => String(index() + 1)),
            h('span', { class: 'ohne-links-label' }, () => {
              const resolved = labelOf(target.name, link());
              return isUndefined(resolved)
                ? h('span', { class: 'cell-mono cell-dim' }, link().slice(0, 8))
                : resolved;
            }),
            button('↑', {
              variant: 'ghost',
              disabled: () => index() === 0,
              onClick: () => move(link(), -1),
            }),
            button('↓', {
              variant: 'ghost',
              disabled: () => index() === links.value.length - 1,
              onClick: () => move(link(), 1),
            }),
            button('✕', {
              variant: 'ghost',
              ariaLabel: t('dashboard.unlink'),
              onClick: () => change(links.value.filter((entry) => entry !== link())),
            }),
          ),
      ),
      h(
        'div',
        { class: 'ohne-links-add' },
        recordSelect({
          field: context.field,
          mode: 'form',
          stayOpen: true,
          value: () => null,
          exclude: () => links.value,
          placeholder: () => t('dashboard.linkRecord'),
          onPick: (uuid) => {
            if (isString(uuid) && !links.value.includes(uuid)) change([...links.value, uuid]);
          },
        }),
      ),
    );

    return {
      element,
      read() {
        if (!touched.value && isUndefined(context.initial)) return {};
        return { value: links.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error: () => routed.value,
      dirty: () => touched.value && !deepEqual(links.value, base),
      focus: () => element.focus(),
      revert() {
        links.value = base;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = listOf(value);
        links.value = base;
        touched.value = false;
        routed.value = '';
      },
    };
  },
};

/**
 * The stored value as a `UUID` list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

registerFieldType('records', recordsType);
