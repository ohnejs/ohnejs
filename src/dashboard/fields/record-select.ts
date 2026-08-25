import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from '../ui/button.ts';
import { icon } from '../ui/icon.ts';
import { popover } from '../ui/popover.ts';
import { createTargetSearch, labelFieldOf, rowLabel, type SearchRow, targetOf } from './_search.ts';
import { labelOf, seedLabel } from './labels.ts';

/**
 * Options for `recordSelect`.
 */
export interface RecordSelectOptions {
  /**
   * The relation field, of kind `record`.
   */
  field: DashboardField;

  /**
   * Where the select lives.
   * `cell` opens straight into search and cancels on Escape or a click elsewhere.
   * `form` rests as a closed value button and opens on demand.
   */
  mode: 'cell' | 'form';

  /**
   * The linked `UUID`, reactive; `null` when nothing is linked.
   */
  value: () => string | null;

  /**
   * A pick or an unlink. A form control stores it; a cell editor commits it.
   */
  onPick(uuid: string | null): void;

  /**
   * Cell mode only: called when the search closes without a pick.
   */
  onCancel?(): void;

  /**
   * The id for the search input and the closed value button, wiring the row's label.
   */
  inputId?: string;

  /**
   * Keeps the search open after a pick, clearing the input, so a list adds link after link.
   *
   * @default
   * false
   */
  stayOpen?: boolean;

  /**
   * The `UUID`s the result list hides, reactive; a links list passes what it already holds.
   */
  exclude?: () => readonly string[];

  /**
   * Replaces the resting value text and the search hint, for callers without a single value.
   * Read reactively, so a translated text resolves when its catalog lands.
   */
  placeholder?: () => string;
}

let sequence = 0;

css`
  .ohne-recsel {
    position: relative;
  }

  .ohne-recsel-value {
    display: flex;
    align-items: center;
    gap: var(--s2);
    width: 100%;
    height: 28px;
    box-sizing: border-box;
    padding: 0 9px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    color: var(--text);
    font: 400 var(--fs-body) var(--sans);
    cursor: default;
    transition:
      border-color var(--pace),
      box-shadow var(--pace);
  }

  .ohne-recsel-value:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }

  .ohne-recsel-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .ohne-recsel-value .ohne-icon {
    color: var(--dim);
  }

  .ohne-recsel-row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    height: 28px;
    padding: 0 10px;
    white-space: nowrap;
    cursor: default;
  }

  .ohne-recsel-row.highlighted {
    background: var(--accent-wash);
  }

  .ohne-recsel-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-recsel-row-uuid {
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--faint);
  }

  .ohne-recsel-closed {
    display: flex;
    align-items: center;
    gap: var(--s1);
  }

  .ohne-recsel-note {
    padding: 6px 10px;
    color: var(--dim);
  }

  .ohne-recsel-foot {
    padding: 5px 10px;
    border-top: 1px solid var(--line);
  }
`;

/**
 * The `record` relation's combobox: a resolved-label value that opens into a searched pick list.
 *
 * The list floats in a body-level popover, so it never clips inside a cell or a scroll pane.
 * Arrows move, Enter acts on the highlight, Escape closes.
 * The unlink row is a labeled first-class option on a nullable field.
 * A pick seeds the label cache, so the value renders without a fetch.
 * Resolves `undefined` when the target is unreadable or has no text field; the caller falls back.
 */
export function recordSelect(options: RecordSelectOptions): Child | undefined {
  const target = targetOf(options.field);
  if (isUndefined(target)) return undefined;
  const label = labelFieldOf(target);
  if (isUndefined(label)) return undefined;

  const t = useT();
  const search = createTargetSearch(target, label);
  const open = ref(options.mode === 'cell');
  const highlighted = ref(0);
  const listID = `ohne-recsel-${(sequence += 1)}`;
  let picked = false;

  let searchInput: HTMLInputElement | undefined;

  const unlinkable = (): boolean => options.field.nullable && !isNull(options.value());
  const offset = (): number => (unlinkable() ? 1 : 0);
  const visible = (): readonly SearchRow[] => {
    const hidden = options.exclude?.();
    const rows = search.rows();
    if (isUndefined(hidden) || hidden.length === 0) return rows;
    return rows.filter((row) => !isString(row.UUID) || !hidden.includes(row.UUID));
  };
  const count = (): number => visible().length + offset();

  const pick = (uuid: string | null): void => {
    picked = true;
    if (!isNull(uuid)) {
      const row = search.rows().find((entry) => entry.UUID === uuid);
      if (!isUndefined(row)) {
        const text = row[label.name];
        seedLabel(target.name, uuid, isString(text) && text !== '' ? text : uuid);
      }
    }
    options.onPick(uuid);
    if (options.stayOpen === true && !isNull(uuid)) {
      picked = false;
      highlighted.value = 0;
      if (!isUndefined(searchInput)) {
        searchInput.value = '';
        searchInput.focus();
      }
      search.search('');
      return;
    }
    open.value = false;
  };

  const close = (): void => {
    open.value = false;
    if (options.mode === 'cell' && !picked) options.onCancel?.();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = clamp(highlighted.value + delta, 0, Math.max(0, count() - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = highlighted.value;
      if (unlinkable() && index === 0) {
        pick(null);
        return;
      }
      const row = visible()[index - offset()];
      if (!isUndefined(row) && isString(row.UUID)) pick(row.UUID);
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key === 'Backspace' && options.mode === 'form') {
      const input = event.target as HTMLInputElement;
      if (input.value === '' && !isNull(options.value())) pick(null);
    } else if (event.key === 'Escape' && !open.value) {
      event.preventDefault();
      options.onCancel?.();
    }
  };

  const optionID = (index: number): string => `${listID}-option-${index}`;

  const searchBox = (): Child => {
    picked = false;
    // Every opening starts fresh: highlight on the first row, the unfiltered list priming.
    highlighted.value = 0;
    search.prime();
    const input = h('input', {
      class: options.mode === 'cell' ? 'cell-editor' : 'ohne-input',
      type: 'text',
      id: options.inputId,
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': listID,
      'aria-activedescendant': () => optionID(highlighted.value),
      placeholder: () => {
        if (!isUndefined(options.placeholder)) return options.placeholder();
        const current = options.value();
        return isNull(current) ? t('dashboard.search') : (labelOf(target.name, current) ?? current);
      },
      onKeydown,
      onInput: () => {
        highlighted.value = 0;
        search.search((input as HTMLInputElement).value);
      },
    }) as HTMLInputElement;
    searchInput = input;
    queueMicrotask(() => input.focus());
    return [
      input,
      popover(
        { anchor: input, onClose: close },
        h(
          'div',
          { role: 'listbox', id: listID },
          () =>
            unlinkable()
              ? h(
                  'div',
                  {
                    class: () => `ohne-recsel-row${highlighted.value === 0 ? ' highlighted' : ''}`,
                    role: 'option',
                    id: optionID(0),
                    onClick: () => pick(null),
                    onMouseenter: () => {
                      highlighted.value = 0;
                    },
                  },
                  h('span', { class: 'cell-dim' }, () => t('dashboard.unlink')),
                )
              : null,
          each(
            () => visible(),
            (row, index) => String(row.UUID ?? index),
            (row, index) =>
              h(
                'div',
                {
                  class: () =>
                    `ohne-recsel-row${
                      highlighted.value === index() + offset() ? ' highlighted' : ''
                    }`,
                  role: 'option',
                  id: () => optionID(index() + offset()),
                  onClick: () => {
                    const uuid = row().UUID;
                    if (isString(uuid)) pick(uuid);
                  },
                  onMouseenter: () => {
                    highlighted.value = index() + offset();
                  },
                },
                h('span', { class: 'ohne-recsel-row-label' }, () => rowLabel(row(), label.name)),
                h('span', { class: 'ohne-recsel-row-uuid' }, () =>
                  isString(row().UUID) ? (row().UUID as string).slice(0, 8) : '',
                ),
              ),
          ),
          () => (search.settled() ? null : h('div', { class: 'ohne-recsel-note' }, '···')),
          () =>
            search.settled() && visible().length === 0
              ? h('div', { class: 'ohne-recsel-note' }, () => t('dashboard.noMatches'))
              : null,
          () =>
            search.rows().length >= 8
              ? h('div', { class: 'ohne-recsel-foot ohne-caps' }, () => t('dashboard.typeToNarrow'))
              : null,
        ),
      ),
    ];
  };

  const closedValue = (): Child => {
    const value = h(
      'button',
      {
        class: 'ohne-recsel-value',
        type: 'button',
        id: options.inputId,
        onClick: () => {
          open.value = true;
        },
      },
      h('span', { class: 'ohne-recsel-label' }, () => {
        const current = options.value();
        if (isNull(current)) {
          return h(
            'span',
            { class: 'cell-dim' },
            options.placeholder?.() ?? t('dashboard.notLinked'),
          );
        }
        const resolved = labelOf(target.name, current);
        return isUndefined(resolved)
          ? h('span', { class: 'cell-mono cell-dim' }, current.slice(0, 8))
          : resolved;
      }),
      icon('chevron-down'),
    );
    return h('div', { class: 'ohne-recsel-closed' }, value, () =>
      unlinkable()
        ? button('✕', {
            variant: 'ghost',
            ariaLabel: t('dashboard.unlink'),
            onClick: () => options.onPick(null),
          })
        : null,
    );
  };

  if (options.mode === 'cell') {
    return h('div', { class: 'ohne-recsel' }, searchBox());
  }
  return h(
    'div',
    { class: 'ohne-recsel' },
    when(
      () => open.value,
      () => searchBox(),
      () => closedValue(),
    ),
  );
}
