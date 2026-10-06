import type { DashboardField } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { omit } from '../../../utils/object/omit.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { structure } from '../../ui/structure.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFormSupports } from '../_items.ts';
import { summaryParts, summarySpan, summaryTitle } from '../_summary.ts';
import { clipboardData, stripUUIDs } from '../clipboard.ts';
import { createFieldForm } from '../field-form.ts';
import {
  dimMark,
  type FieldControlContext,
  type FieldType,
  registerFieldType,
} from '../field-type.ts';
import { structureActions, structureErrorMark, structureItemError } from '../structure-chrome.ts';

/**
 * One list row: the structure's `$key` and `$expanded` beside the item's form and its own message.
 * A type literal, so the structure's `Record<string, unknown>` item constraint accepts it.
 */
type RepeaterEntry = {
  $key: number;
  $expanded: boolean;
  form: FieldForm;
  own: Ref<string>;
};

// Shared across every repeater control, so a cross-structure drop never lands a colliding `$key`.
let nextEntryKey = 0;

css`
  .ohne-structure:not(.ohne-structure-empty) + .ohne-repeater-add {
    margin-top: 0.75rem;
  }

  .ohne-structure-dropzone + .ohne-repeater-add {
    display: none;
  }
`;

/**
 * The `repeater` field's dashboard behaviour.
 *
 * Cells digest the first item's values on one line, a dim `+N` counting the rest.
 * A first item with nothing to show keeps the dim item count.
 * There is no inline cell editor: the list edits on the record page as structure cards.
 * Cards drag-reorder across matching repeaters and collapse.
 * Kept items ride their `UUID`.
 * A pasted, duplicated, or cross-dropped item sheds every `UUID` and inserts as a new row.
 * The record's one save writes the list whole.
 */
export const repeaterType: FieldType = {
  display({ field, value }) {
    const t = useT();
    const subfields = field.subfields ?? [];
    return () => {
      const current = value();
      const items = isArray(current) ? current : [];
      if (items.length === 0) return dimMark('-');
      const first = items[0];
      if (!isPlainObject<Record<string, unknown>>(first)) return dimMark(`${items.length} ×`);
      const parts = summaryParts(first, subfields);
      if (parts.length === 0) return dimMark(`${items.length} ×`);
      return [
        summarySpan(parts, summaryTitle(first, subfields, t)),
        items.length > 1 ? dimMark(` +${items.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const subfields = context.field.subfields ?? [];
    if (subfields.length === 0 || !itemFormSupports(subfields, blocksOf())) return undefined;
    const t = useT();

    const itemType =
      'repeater:' +
      subfields
        .map((field) => `${field.name}=${field.type ?? field.logicalType ?? ''}`)
        .sort()
        .join(',');

    const off = context.disabled === true;
    let base = context.initial;
    // Items built in event handlers have no active scope; the owner catches their effects for teardown.
    const owner = effectScope();
    const ownForms = new WeakSet<FieldForm>();

    const entryOf = (
      item: Readonly<Record<string, unknown>> | undefined,
      expanded: boolean,
    ): RepeaterEntry => {
      const key = (nextEntryKey += 1);
      const form = owner.run(() => itemForm(context, subfields, item, key));
      ownForms.add(form);
      return { $key: key, $expanded: expanded, form, own: ref('') };
    };

    const baseItems = (): Readonly<Record<string, unknown>>[] =>
      (isArray(base) ? base : []).filter((item) => isPlainObject<Record<string, unknown>>(item));

    const baseEntries = (expanded: boolean): RepeaterEntry[] =>
      baseItems().map((item) => entryOf(item, expanded));

    const entries = ref<RepeaterEntry[]>(baseEntries(true));
    const touched = ref(false);
    const routed = ref('');

    const allExpanded = (): boolean => entries.value.every((entry) => entry.$expanded);
    const allCollapsed = (): boolean => entries.value.every((entry) => !entry.$expanded);
    const flagged = (entry: RepeaterEntry): boolean =>
      entry.own.value !== '' || entry.form.errored();

    const rebuild = (): void => {
      for (const entry of entries.value) entry.form.dispose();
      const expanded = entries.value.length === 0 || !allCollapsed();
      entries.value = baseEntries(expanded);
    };

    const change = (next: RepeaterEntry[]): void => {
      entries.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const valueOf = (form: FieldForm): Record<string, unknown> => {
      const value = stripUUIDs(form.read().value);
      return isPlainObject<Record<string, unknown>>(value) ? value : {};
    };

    const move = (target: RepeaterEntry, delta: -1 | 1): void => {
      const list = [...entries.value];
      const from = list.indexOf(target);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [entry] = list.splice(from, 1);
      list.splice(to, 0, entry as RepeaterEntry);
      change(list);
    };

    const addAt = (at?: number): RepeaterEntry => {
      const entry = entryOf(undefined, true);
      const list = entries.value;
      change(isUndefined(at) ? [...list, entry] : [...list.slice(0, at), entry, ...list.slice(at)]);
      return entry;
    };

    const remove = (target: RepeaterEntry): void => {
      target.form.dispose();
      change(entries.value.filter((entry) => entry !== target));
    };

    const duplicate = (target: RepeaterEntry): void => {
      const list = entries.value;
      const at = list.indexOf(target);
      if (at < 0) return;
      const copy = entryOf(valueOf(target.form), target.$expanded);
      change([...list.slice(0, at), copy, ...list.slice(at)]);
    };

    const pasteAt = (at: number): void => {
      const payload = clipboardData.value;
      if (isNull(payload) || payload.ohneClipboardDataType !== 'structure-item') return;
      const entry = entryOf(omit(payload.data, ['$type']), true);
      const list = entries.value;
      change([...list.slice(0, at), entry, ...list.slice(at)]);
    };

    const toggleExpanded = (target: RepeaterEntry): void => {
      entries.value = entries.value.map((entry) =>
        entry === target ? { ...entry, $expanded: !entry.$expanded } : entry,
      );
    };

    const setAllExpanded = (expanded: boolean): void => {
      entries.value = entries.value.map((entry) => ({ ...entry, $expanded: expanded }));
    };

    // A cross-dropped item's form lives in the donor's scope, so it rebuilds here, shed of every `UUID`.
    const settle = (items: RepeaterEntry[]): void => {
      change(
        items.map((item) =>
          ownForms.has(item.form) ? item : entryOf(valueOf(item.form), item.$expanded),
        ),
      );
    };

    const element = h(
      'div',
      { tabindex: '-1' },
      structure<RepeaterEntry>(entries, {
        types: [itemType],
        resolveItemType: () => itemType,
        allowCrossDrop: true,
        disabled: () => off,
        isDraggable: !off,
        dropItemsHereLabel: t('dashboard.dropItemsHere'),
        header: (entry, index) => [
          h('span', { class: 'ohne-muted ohne-truncate' }, () => `#${index() + 1}`),
          off
            ? null
            : structureActions({
                index,
                count: () => entries.value.length,
                expanded: () => entry().$expanded,
                allExpanded,
                allCollapsed,
                onToggleExpanded: () => toggleExpanded(entry()),
                onExpandAll: () => setAllExpanded(true),
                onCollapseAll: () => setAllExpanded(false),
                onMove: (delta) => move(entry(), delta),
                onAdd: (at) => addAt(at),
                copyPayload: () => ({
                  ohneClipboardDataType: 'structure-item',
                  data: { $type: itemType, ...valueOf(entry().form) },
                }),
                canPaste: () => {
                  const payload = clipboardData.value;
                  return (
                    !isNull(payload) &&
                    payload.ohneClipboardDataType === 'structure-item' &&
                    payload.data.$type === itemType
                  );
                },
                onPaste: pasteAt,
                onDuplicate: () => duplicate(entry()),
                onRemove: () => remove(entry()),
              }),
        ],
        // The form is stable per row, so an untracked read is safe; it holds focus through expand-all.
        item: (entry) =>
          h('div', { class: 'ohne-repeater-item' }, untracked(() => entry().form).render()),
        itemBefore: (entry) =>
          structureErrorMark(
            () => entry().own.value !== '' || (!entry().$expanded && entry().form.errored()),
          ),
        itemAfter: (entry) => structureItemError(() => entry().own.value),
        onCommit: settle,
      }),
      h(
        'div',
        { class: 'ohne-repeater-add' },
        button([icon('plus'), h('span', null, () => t('dashboard.addItem'))], {
          variant: 'outline',
          disabled: off ? (): boolean => true : undefined,
          onClick: () => {
            const entry = addAt();
            queueMicrotask(() => entry.form.focus());
          },
        }),
      ),
    );

    return {
      element,
      read() {
        const live = entries.value;
        if (!touched.value && isUndefined(base) && !live.some((entry) => entry.form.dirty())) {
          return {};
        }
        const errors = blank();
        const items: Record<string, unknown>[] = [];
        live.forEach((entry, index) => {
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
        const live = entries.value;
        for (const entry of live) entry.own.value = '';
        const grouped = new Map<number, Record<string, string>>();
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]/.exec(key);
          const entry = isNull(match) ? undefined : live[Number(match[1])];
          if (isNull(match) || isUndefined(entry)) {
            if (unplaced === '') unplaced = message;
            continue;
          }
          const rest = key.slice(match[0].length);
          if (rest === '') {
            entry.own.value = message;
            continue;
          }
          if (rest.startsWith('.')) {
            const index = Number(match[1]);
            const scoped = grouped.get(index) ?? blank();
            scoped[rest.slice(1)] = message;
            grouped.set(index, scoped);
            continue;
          }
          if (unplaced === '') unplaced = message;
        }
        live.forEach((entry, index) => {
          const leftover = entry.form.setErrors(grouped.get(index) ?? blank());
          if (leftover !== '' && unplaced === '') unplaced = leftover;
        });
        entries.value = entries.value.map((entry) =>
          flagged(entry) && !entry.$expanded ? { ...entry, $expanded: true } : entry,
        );
        return unplaced;
      },
      error: () => routed.value,
      errored: () => entries.value.some(flagged),
      dirty: () => touched.value || entries.value.some((entry) => entry.form.dirty()),
      focus() {
        const target = entries.value.find(flagged) ?? entries.value[0];
        if (isUndefined(target)) return;
        if (!target.$expanded) {
          entries.value = entries.value.map((entry) =>
            entry === target ? { ...entry, $expanded: true } : entry,
          );
        }
        // The expanded body mounts on the reactive flush's microtask; focusing sooner hits a detached input.
        queueMicrotask(() => {
          if (!target.form.focusError()) target.form.focus();
        });
      },
      revert() {
        rebuild();
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        const items = baseItems();
        // A matching length rebases in place, keeping each item's controls and their focus.
        if (items.length === entries.value.length) {
          entries.value.forEach((entry, index) => {
            entry.form.rebase(items[index]);
            entry.own.value = '';
          });
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
 * One item's form, its ids keyed by the entry's `$key` so reordered rows never collide.
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
    disabled: context.disabled === true,
    layout: context.field.layout,
    language: context.language,
    ancestors: context.ancestors,
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
