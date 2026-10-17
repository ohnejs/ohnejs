import type { DashboardField } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';
import type { RepeaterFieldOptions } from '../known-field-types.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { omit } from '../../../utils/object/omit.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { checkCount } from '../../../utils/validate/check-count.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { structure } from '../../ui/structure.ts';
import { blocksOf } from '../_blocks.ts';
import { checkedReading } from '../_checked-reading.ts';
import { itemFolds, listFolds } from '../_folds.ts';
import { entryKey, identityOf, itemFormSupports, uuidOf } from '../_items.ts';
import { summaryParts, summarySpan, summaryTitle } from '../_summary.ts';
import { clipboardData, stripIdentities } from '../clipboard.ts';
import { createFieldForm } from '../field-form.ts';
import {
  dimMark,
  type FieldControlContext,
  type FieldFolds,
  type FieldType,
  registerFieldType,
} from '../field-type.ts';
import {
  focusAfterRemoval,
  focusAfterRestore,
  focusOrigin,
  type ItemFocus,
  structureActions,
  structureErrorMark,
  structureItemError,
  trackItemFocus,
} from '../structure-chrome.ts';

/**
 * One list row: the structure's `$key` and `$expanded` beside the item's form and its own message.
 * `uuid` is the stored item's; a fresh or copied item has none and drafts its `$key` in its place.
 * Either one keys the item's folds and finds its entry again across undo states.
 * `focus` remembers where focus stood around the item, shared by the copies an expand toggle makes.
 * A type literal, so the structure's `Record<string, unknown>` item constraint accepts it.
 */
type RepeaterEntry = {
  $key: number;
  $expanded: boolean;
  uuid: string | undefined;
  form: FieldForm;
  own: Ref<string>;
  focus: ItemFocus;
};

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
 * A changed list is checked against `min` and `max`, with the server's messages.
 */
export const repeaterType: FieldType<RepeaterFieldOptions> = {
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
      folds?: FieldFolds,
      key = entryKey(item),
    ): RepeaterEntry => {
      const form = owner.run(() => itemForm(context, subfields, item, key, folds));
      ownForms.add(form);
      return {
        $key: key,
        $expanded: expanded && folds?.collapsed !== true,
        uuid: uuidOf(item),
        form,
        own: ref(''),
        focus: {},
      };
    };

    const baseItems = (): Readonly<Record<string, unknown>>[] => itemsOf(base);

    const baseEntries = (expanded: boolean, folds?: FieldFolds): RepeaterEntry[] =>
      baseItems().map((item) => entryOf(item, expanded, itemFolds(folds, item)));

    // An item the list no longer holds is rebuilt over its stored base, so its dirt reads against the record.
    const entryFor = (
      item: Readonly<Record<string, unknown>>,
      expanded: boolean,
    ): RepeaterEntry => {
      const uuid = uuidOf(item);
      const stored = baseItems().find((candidate) => !isUndefined(uuid) && candidate.UUID === uuid);
      const entry = entryOf(stored, expanded, itemFolds(context.folds, item), entryKey(item));
      entry.uuid = uuid;
      entry.form.restore(item);
      return entry;
    };

    const unmoved = (list: readonly RepeaterEntry[]): boolean => {
      const items = baseItems();
      return (
        items.length === list.length &&
        list.every((entry, index) => (entry.uuid ?? entry.$key) === identityOf(items[index]))
      );
    };

    const entries = ref<RepeaterEntry[]>(baseEntries(true, context.folds));
    const touched = ref(false);
    const routed = ref('');
    // Entries a removal or a restore took out, kept whole so an undo brings back the same card and fold.
    const parked: RepeaterEntry[] = [];

    const unpark = (): void => {
      for (const entry of parked.splice(0)) entry.form.dispose();
    };

    const allExpanded = (): boolean => entries.value.every((entry) => entry.$expanded);
    const allCollapsed = (): boolean => entries.value.every((entry) => !entry.$expanded);
    const flagged = (entry: RepeaterEntry): boolean =>
      entry.own.value !== '' || entry.form.errored();

    const rebuild = (): void => {
      unpark();
      for (const entry of entries.value) entry.form.dispose();
      const expanded = entries.value.length === 0 || !allCollapsed();
      entries.value = baseEntries(expanded);
    };

    const change = (next: RepeaterEntry[]): void => {
      entries.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput(true);
    };

    const valueOf = (form: FieldForm): Record<string, unknown> => {
      const value = stripIdentities(form.draft());
      return isPlainObject<Record<string, unknown>>(value) ? value : {};
    };

    const draftOf = (entry: RepeaterEntry): unknown => {
      const draft = entry.form.draft();
      return isUndefined(entry.uuid) ? { ...draft, $key: entry.$key } : draft;
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

    const insert = (
      entry: RepeaterEntry,
      at: number | undefined,
      source?: RepeaterEntry,
    ): RepeaterEntry => {
      entry.focus.origin = focusOrigin(document.activeElement, source);
      const list = entries.value;
      change(isUndefined(at) ? [...list, entry] : [...list.slice(0, at), entry, ...list.slice(at)]);
      return entry;
    };

    const addAt = (at?: number, source?: RepeaterEntry): RepeaterEntry =>
      insert(entryOf(undefined, true), at, source);

    const remove = (target: RepeaterEntry): void => {
      const at = entries.value.indexOf(target);
      if (at < 0) return;
      target.focus.origin = undefined;
      parked.push(target);
      change(entries.value.filter((entry) => entry !== target));
      focusAfterRemoval(entries.value, at, addButton);
    };

    const duplicate = (target: RepeaterEntry): RepeaterEntry | undefined => {
      const at = entries.value.indexOf(target);
      if (at < 0) return undefined;
      return insert(entryOf(valueOf(target.form), target.$expanded), at, target);
    };

    const pasteAt = (at: number, source: RepeaterEntry): RepeaterEntry | undefined => {
      const payload = clipboardData.value;
      if (isNull(payload) || payload.ohneClipboardDataType !== 'structure-item') return undefined;
      return insert(entryOf(omit(payload.data, ['$type']), true), at, source);
    };

    // The new card mounts on the reactive flush's microtask; focusing sooner hits a detached input.
    const focusNew = (entry: RepeaterEntry | undefined): void => {
      queueMicrotask(() => entry?.form.focus());
    };

    const toggleExpanded = (target: RepeaterEntry): void => {
      entries.value = entries.value.map((entry) =>
        entry === target ? { ...entry, $expanded: !entry.$expanded } : entry,
      );
    };

    const setAllExpanded = (expanded: boolean): void => {
      entries.value = entries.value.map((entry) => ({ ...entry, $expanded: expanded }));
    };

    // A cross-dropped item's form lives in the donor's scope, so it rebuilds here, shed of every identity.
    const settle = (items: RepeaterEntry[]): void => {
      change(
        items.map((item) =>
          ownForms.has(item.form) ? item : entryOf(valueOf(item.form), item.$expanded),
        ),
      );
    };

    const addButton = button([icon('plus'), h('span', null, () => t('dashboard.addItem'))], {
      variant: 'outline',
      disabled: off ? (): boolean => true : undefined,
      onClick: () => focusNew(addAt()),
    });

    const element = h(
      'div',
      { tabindex: '-1' },
      structure<RepeaterEntry>(entries, {
        types: [itemType],
        resolveItemType: () => itemType,
        allowCrossDrop: true,
        disabled: () => off,
        isDraggable: !off,
        dropItemsHereLabel: () => t('dashboard.dropItemsHere'),
        header: (entry, index) => [
          h('span', { class: 'ohne-muted ohne-truncate' }, () => `#${index() + 1}`),
          off
            ? null
            : trackItemFocus(
                untracked(() => entry().focus),
                structureActions({
                  index,
                  count: () => entries.value.length,
                  expanded: () => entry().$expanded,
                  allExpanded,
                  allCollapsed,
                  onToggleExpanded: () => toggleExpanded(entry()),
                  onExpandAll: () => setAllExpanded(true),
                  onCollapseAll: () => setAllExpanded(false),
                  onMove: (delta) => move(entry(), delta),
                  onAdd: (at) => focusNew(addAt(at, entry())),
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
                  onPaste: (at) => focusNew(pasteAt(at, entry())),
                  onDuplicate: () => focusNew(duplicate(entry())),
                  onRemove: () => remove(entry()),
                }),
                false,
              ),
        ],
        // The form and the memory are stable per row, so untracked reads hold focus through expand-all.
        item: (entry) =>
          trackItemFocus(
            untracked(() => entry().focus),
            h('div', { class: 'ohne-repeater-item' }, untracked(() => entry().form).render()),
            true,
          ),
        itemBefore: (entry) =>
          structureErrorMark(
            () => entry().own.value !== '' || (!entry().$expanded && entry().form.errored()),
          ),
        itemAfter: (entry) => structureItemError(() => entry().own.value),
        onCommit: settle,
      }),
      h('div', { class: 'ohne-repeater-add' }, addButton),
    );

    const dirty = (): boolean => touched.value || entries.value.some((entry) => entry.form.dirty());
    const pristine = (): boolean =>
      !touched.value && isUndefined(base) && !entries.value.some((entry) => entry.form.dirty());

    return {
      element,
      read() {
        if (pristine()) return {};
        const live = entries.value;
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
        const options = context.field.options ?? {};
        return checkedReading(items, dirty() ? checkCount(items.length, options) : undefined);
      },
      draft() {
        return pristine() ? undefined : entries.value.map(draftOf);
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
      folds: () => listFolds(entries.value),
      dirty,
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
        unpark();
        const items = baseItems();
        // A matching length rebases in place, keeping each item's controls and their focus.
        if (items.length === entries.value.length) {
          entries.value.forEach((entry, index) => {
            const item = items[index];
            entry.uuid = uuidOf(item);
            entry.form.rebase(item);
            entry.own.value = '';
          });
        } else {
          rebuild();
        }
        touched.value = false;
        routed.value = '';
      },
      restore(value) {
        const live = entries.value;
        const expanded = live.length === 0 || !allCollapsed();
        const pool = [...parked.splice(0), ...live];
        // A live entry wins over a parked one with the same identity.
        const known = new Map(pool.map((entry) => [entry.uuid ?? entry.$key, entry]));
        const next = itemsOf(value).map((item) => {
          const identity = identityOf(item);
          const entry = isUndefined(identity) ? undefined : known.get(identity);
          if (isUndefined(entry)) return entryFor(item, expanded);
          entry.own.value = '';
          entry.form.restore(item);
          return entry;
        });
        parked.push(...pool.filter((entry) => !next.includes(entry)));
        entries.value = next;
        touched.value = !unmoved(next);
        routed.value = '';
        focusAfterRestore(live, next, addButton);
      },
    };
  },
};

/**
 * The stored items of a list value, anything that is no item dropped.
 */
function itemsOf(value: unknown): Readonly<Record<string, unknown>>[] {
  return (isArray(value) ? value : []).filter((item) =>
    isPlainObject<Record<string, unknown>>(item),
  );
}

/**
 * One item's form, its ids keyed by the entry's `$key` so reordered rows never collide.
 */
function itemForm(
  context: FieldControlContext,
  subfields: readonly DashboardField[],
  item: Readonly<Record<string, unknown>> | undefined,
  key: number,
  folds: FieldFolds | undefined,
): FieldForm {
  return createFieldForm(subfields, item, {
    mode: context.mode,
    path: `${context.path}[${key}]`,
    attachUUID: true,
    disabled: context.disabled === true,
    layout: context.field.layout,
    language: context.language,
    ancestors: context.ancestors,
    folds,
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
