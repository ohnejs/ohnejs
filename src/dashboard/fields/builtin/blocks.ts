import type { DashboardBlock } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';
import type { FieldControl, FieldFolds } from '../field-type.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { omit } from '../../../utils/object/omit.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { structure, type StructureHandle } from '../../ui/structure.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFolds, listFolds } from '../_folds.ts';
import { blockNamed, entryKey, identityOf, itemFormSupports, uuidOf } from '../_items.ts';
import { openBlockPicker } from '../block-picker-popup.ts';
import { clipboardData, stripIdentities } from '../clipboard.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerUntypedFieldType } from '../field-type.ts';
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
 * One editable block instance in a `blocks` list.
 *
 * `$key` is local and monotonic, never the instance `UUID`.
 * A fresh item has no `UUID` yet, and a reordered row must keep its DOM.
 * `uuid` absent is what inserts the item on save; such an item drafts its `$key` in its place.
 * Either one keys the item's folds and finds its node again across undo states.
 * `$expanded` gates only rendering; the form outlives every collapse, so edits survive.
 * Expanding replaces the node with a copy, so `$key` and `form` identify it, never the object.
 * `focus` remembers where focus stood around the item, shared by those copies.
 * A type literal, so the structure's `Record<string, unknown>` item constraint accepts it.
 */
export type BlockNode = {
  $key: number;
  $expanded: boolean;
  block: string;
  uuid: string | undefined;
  form: FieldForm;
  own: Ref<string>;
  focus: ItemFocus;
};

/**
 * The live surface of one `blocks` list, for an editor that shows the list without its cards.
 * Every change runs through the field's own input, so history and dirt follow as they do for cards.
 */
export interface BlocksHandle {
  /**
   * The block types the list admits.
   */
  offered: readonly string[];

  /**
   * Whether the list is locked, for a viewer who cannot write.
   */
  disabled: boolean;

  /**
   * The list's blocks, in order.
   * Reactive.
   */
  nodes(): readonly BlockNode[];

  /**
   * Builds a block of type `name` that belongs to this list, without placing it.
   * `fields` seeds it, as a paste or a duplicate does.
   */
  create(name: string, fields?: Readonly<Record<string, unknown>>): BlockNode;

  /**
   * The block's field values without any `UUID`, the shape a copy carries.
   */
  copy(node: BlockNode): Record<string, unknown>;

  /**
   * Replaces the list and answers the placed nodes.
   * A block from another list is rebuilt as a new one here, so commit the receiving list first.
   * A block left out is disposed.
   */
  commit(next: readonly BlockNode[]): BlockNode[];

  /**
   * Called in place of expanding a card when the field focuses a block, as after a failed save.
   * Set it when another surface shows the blocks; the card view leaves it unset.
   */
  onReveal: ((node: BlockNode) => void) | undefined;
}

const handles = new WeakMap<FieldControl, BlocksHandle>();

/**
 * The handle of a `blocks` field's control, or `undefined` for any other control.
 */
export function blocksHandleOf(control: FieldControl | undefined): BlocksHandle | undefined {
  return isUndefined(control) ? undefined : handles.get(control);
}

css`
  .ohne-structure:not(.ohne-structure-empty) + .ohne-blocks-add {
    margin-top: 0.75rem;
  }

  .ohne-structure-dropzone + .ohne-blocks-add {
    display: none;
  }
`;

/**
 * The `blocks` field's dashboard behaviour.
 *
 * Cells summarize the list as the first block's type label plus a dim `+n` tail.
 * There is no inline cell editor: the list edits on the record page as structure cards.
 * Cards drag-reorder across blocks fields that admit the type, and collapse.
 * Adding opens the block picker when several types are admitted, and adds directly when one is.
 * Nested `blocks` subfields recurse through this same control, so depth costs one card per level.
 * The record's one save writes the whole list: an item keeps its `UUID`, anything left out is deleted.
 * A pasted, duplicated, or cross-dropped item sheds every `UUID` and inserts as new.
 *
 * A stored type the registry cannot round-trip refuses the control.
 * The field then falls back to a locked read-only row and the stored value carries through untouched.
 */
export const blocksType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      const items = isArray(current) ? current : [];
      if (items.length === 0) return dimMark('-');
      const first = items[0];
      const name =
        isPlainObject<Record<string, unknown>>(first) && isString(first.block) ? first.block : '';
      const label = labelOf(name, blocksOf());
      return [
        h('span', { class: 'ohne-truncate', title: label }, label),
        items.length > 1 ? dimMark(` +${items.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const blocks = blocksOf();
    const stored = storedTypes(context.initial);
    if (!stored.every((name) => editable(name, blocks))) return undefined;
    const offered = (context.field.allow ?? []).filter((name) => editable(name, blocks));
    if (offered.length === 0 && stored.length === 0) return undefined;
    const t = useT();

    const off = context.disabled === true;
    let base = context.initial;
    let surface: StructureHandle | undefined;
    // Nodes built from event handlers have no active scope; this owner holds their effects for teardown.
    const owner = effectScope();
    const ownForms = new WeakSet<FieldForm>();

    const nodeOf = (
      item: Readonly<Record<string, unknown>>,
      expanded: boolean,
      folds?: FieldFolds,
      key = entryKey(item),
    ): BlockNode => {
      const name = isString(item.block) ? item.block : '';
      // Seeding a fresh item's form `undefined` keeps its immutable subfields settable.
      const fields = isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : undefined;
      const type = blockNamed(blocks, name);
      const form = owner.run(() =>
        createFieldForm(type?.fields ?? [], fields, {
          mode: context.mode,
          path: `${context.path}[${key}].fields`,
          disabled: context.disabled === true,
          layout: type?.layout,
          language: context.language,
          ancestors: context.ancestors,
          folds,
          onInput: context.onInput,
        }),
      );
      ownForms.add(form);
      return {
        $key: key,
        $expanded: expanded && folds?.collapsed !== true,
        block: name,
        uuid: uuidOf(item),
        form,
        own: ref(''),
        focus: {},
      };
    };

    const baseItems = (): Readonly<Record<string, unknown>>[] => itemsOf(base);

    const baseNodes = (expanded: boolean, folds?: FieldFolds): BlockNode[] =>
      baseItems().map((item) => nodeOf(item, expanded, itemFolds(folds, item)));

    // A block the list no longer holds is rebuilt over its stored base, so its dirt reads against the record.
    const nodeFor = (item: Readonly<Record<string, unknown>>, expanded: boolean): BlockNode => {
      const uuid = uuidOf(item);
      const stored = baseItems().find((candidate) => !isUndefined(uuid) && candidate.UUID === uuid);
      const folds = itemFolds(context.folds, item);
      const node = nodeOf(stored ?? { block: item.block }, expanded, folds, entryKey(item));
      node.uuid = uuid;
      node.form.restore(fieldsOf(item));
      return node;
    };

    const unmoved = (list: readonly BlockNode[]): boolean => {
      const items = baseItems();
      return (
        items.length === list.length &&
        list.every((node, index) => (node.uuid ?? node.$key) === identityOf(items[index]))
      );
    };

    const nodes = ref<BlockNode[]>(baseNodes(true, context.folds));
    const touched = ref(false);
    const routed = ref('');
    // Nodes a removal or a restore took out, kept whole so an undo brings back the same card and fold.
    const parked: BlockNode[] = [];

    const unpark = (): void => {
      for (const node of parked.splice(0)) node.form.dispose();
    };

    const allExpanded = (): boolean => nodes.value.every((node) => node.$expanded);
    const allCollapsed = (): boolean => nodes.value.every((node) => !node.$expanded);
    const flagged = (node: BlockNode): boolean => node.own.value !== '' || node.form.errored();

    const hasFields = (name: string): boolean =>
      (blockNamed(blocks, name)?.fields ?? []).some((field) => field.name !== 'UUID');

    const rebuild = (): void => {
      unpark();
      for (const node of nodes.value) node.form.dispose();
      const expanded = nodes.value.length === 0 || !allCollapsed();
      nodes.value = baseNodes(expanded);
    };

    const change = (next: BlockNode[]): void => {
      nodes.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput(true);
    };

    const valueOf = (node: BlockNode): Record<string, unknown> =>
      stripIdentities(node.form.draft(), blockNamed(blocks, node.block)?.fields ?? []);

    const move = (target: BlockNode, delta: -1 | 1): void => {
      const list = [...nodes.value];
      const from = list.indexOf(target);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [node] = list.splice(from, 1);
      list.splice(to, 0, node as BlockNode);
      change(list);
    };

    const insert = (placed: BlockNode[], at: number | undefined, source?: BlockNode): void => {
      const origin = focusOrigin(document.activeElement, source);
      for (const node of placed) node.focus.origin = origin;
      const list = nodes.value;
      change(
        isUndefined(at)
          ? [...list, ...placed]
          : [...list.slice(0, at), ...placed, ...list.slice(at)],
      );
    };

    const addAt = (name: string, at?: number, source?: BlockNode): BlockNode => {
      const node = nodeOf({ block: name }, true);
      insert([node], at, source);
      return node;
    };

    const remove = (target: BlockNode): void => {
      const at = nodes.value.indexOf(target);
      if (at < 0) return;
      target.focus.origin = undefined;
      parked.push(target);
      change(nodes.value.filter((node) => node !== target));
      if (!isUndefined(addButton)) focusAfterRemoval(nodes.value, at, addButton);
    };

    const duplicate = (target: BlockNode): BlockNode | undefined => {
      const at = nodes.value.indexOf(target);
      if (at < 0) return undefined;
      const copy = nodeOf({ block: target.block, fields: valueOf(target) }, target.$expanded);
      insert([copy], at, target);
      return copy;
    };

    const pasteAt = (at: number, source: BlockNode): BlockNode | undefined => {
      const payload = clipboardData.value;
      if (isNull(payload) || payload.ohneClipboardDataType !== 'blocks') return undefined;
      const pasted = payload.data.map((item) =>
        nodeOf({ block: item.$key, fields: omit(item, ['$key']) }, true),
      );
      insert(pasted, at, source);
      return pasted[0];
    };

    const toggleExpanded = (target: BlockNode): void => {
      nodes.value = nodes.value.map((node) =>
        node === target ? { ...node, $expanded: !node.$expanded } : node,
      );
    };

    const setAllExpanded = (expanded: boolean): void => {
      nodes.value = nodes.value.map((node) => ({ ...node, $expanded: expanded }));
    };

    // A block from another list is rebuilt here, since its form and effects belong to that list.
    const adopt = (item: BlockNode): BlockNode =>
      ownForms.has(item.form)
        ? item
        : nodeOf({ block: item.block, fields: valueOf(item) }, item.$expanded);

    const settle = (items: BlockNode[]): void => {
      change(items.map(adopt));
    };

    // The new card mounts on the reactive flush's microtask; focusing sooner hits a detached input.
    const focusNew = (node: BlockNode | undefined): void => {
      queueMicrotask(() => node?.form.focus());
    };

    const pick = (at?: number, source?: BlockNode): void => {
      void openBlockPicker(offered).then((name) => {
        if (!isNull(name)) focusNew(addAt(name, at, source));
      });
    };

    const handle: BlocksHandle = {
      offered,
      disabled: off,
      nodes: () => nodes.value,
      create: (name, fields) => nodeOf({ block: name, fields }, true),
      copy: (node) => valueOf(node),
      commit(next) {
        const placed = next.map(adopt);
        const kept = new Set(placed.map((node) => node.form));
        for (const node of nodes.value) if (!kept.has(node.form)) node.form.dispose();
        change(placed);
        return placed;
      },
      onReveal: undefined,
    };

    // Built on first read, in the control's scope, so a surface that never shows the cards never builds them.
    let element: HTMLElement | undefined;
    let addButton: HTMLElement | undefined;
    const buildElement = (): HTMLElement => {
      addButton = button([icon('plus'), h('span', null, () => t('dashboard.addBlock'))], {
        variant: 'outline',
        disabled: off || offered.length === 0 ? (): boolean => true : undefined,
        onClick: () => {
          if (offered.length > 1) pick();
          else if (offered.length === 1) focusNew(addAt(offered[0] as string));
        },
      });
      return h(
        'div',
        { tabindex: '-1' },
        structure<BlockNode>(nodes, {
          types: offered,
          resolveItemType: (node) => node.block,
          allowCrossDrop: true,
          disabled: () => off,
          isDraggable: !off,
          dropItemsHereLabel: () => t('dashboard.dropItemsHere'),
          expose: (handle) => {
            surface = handle;
          },
          header: (node, index) => [
            h('span', { class: 'ohne-muted ohne-truncate' }, () => labelOf(node().block, blocks)),
            off
              ? null
              : trackItemFocus(
                  untracked(() => node().focus),
                  structureActions({
                    index,
                    count: () => nodes.value.length,
                    expanded: () => node().$expanded,
                    allExpanded,
                    allCollapsed,
                    onToggleExpanded: () => toggleExpanded(node()),
                    onExpandAll: () => setAllExpanded(true),
                    onCollapseAll: () => setAllExpanded(false),
                    onMove: (delta) => {
                      surface?.resumeScrollWatcher();
                      move(node(), delta);
                      surface?.pauseScrollWatcher();
                    },
                    onAdd:
                      offered.length === 0
                        ? undefined
                        : (at) => {
                            if (offered.length > 1) pick(at, node());
                            else focusNew(addAt(offered[0] as string, at, node()));
                          },
                    copyPayload: () => ({
                      ohneClipboardDataType: 'blocks',
                      data: [{ $key: node().block, ...valueOf(node()) }],
                    }),
                    canPaste: () => {
                      const payload = clipboardData.value;
                      return (
                        !isNull(payload) &&
                        payload.ohneClipboardDataType === 'blocks' &&
                        payload.data.every(({ $key }) => offered.includes($key))
                      );
                    },
                    onPaste: (at) => focusNew(pasteAt(at, node())),
                    onDuplicate: () => focusNew(duplicate(node())),
                    onRemove: () => remove(node()),
                  }),
                  false,
                ),
          ],
          // Untracked reads keep expand-all's replacement from rebuilding the body and dropping focus.
          item: (node) => {
            const form = untracked(() => node().form);
            const name = untracked(() => node().block);
            return trackItemFocus(
              untracked(() => node().focus),
              h(
                'div',
                { class: 'ohne-blocks-item' },
                hasFields(name)
                  ? form.render()
                  : h('span', { class: 'ohne-muted' }, () => t('dashboard.noFieldsToDisplay')),
              ),
              true,
            );
          },
          itemBefore: (node) =>
            structureErrorMark(
              () => node().own.value !== '' || (!node().$expanded && node().form.errored()),
            ),
          itemAfter: (node) => structureItemError(() => node().own.value),
          onCommit: settle,
        }),
        h('div', { class: 'ohne-blocks-add' }, addButton),
      );
    };

    const pristine = (): boolean =>
      !touched.value && isUndefined(base) && !nodes.value.some((node) => node.form.dirty());

    const control: FieldControl = {
      get element() {
        element ??= owner.run(() => untracked(buildElement));
        return element;
      },
      read() {
        if (pristine()) return {};
        const errors = blank();
        const items: Record<string, unknown>[] = [];
        nodes.value.forEach((node, index) => {
          const reading = node.form.read();
          if (!isUndefined(reading.errors)) {
            for (const [key, message] of Object.entries(reading.errors)) {
              errors[`[${index}].fields${key.startsWith('[') ? key : `.${key}`}`] = message;
            }
            return;
          }
          items.push(itemOf(node, reading.value ?? {}));
        });
        if (Object.keys(errors).length > 0) return { errors };
        return { value: items };
      },
      draft() {
        return pristine() ? undefined : nodes.value.map((node) => draftOf(node));
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        let unplaced = '';
        const live = nodes.value;
        const grouped = new Map<number, Record<string, string>>();
        for (const node of live) node.own.value = '';
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]/.exec(key);
          const node = isNull(match) ? undefined : live[Number(match[1])];
          if (isUndefined(node) || isNull(match)) {
            if (unplaced === '') unplaced = message;
            continue;
          }
          const rest = key.slice(match[0].length);
          if (rest === '' || rest === '.block' || rest === '.UUID' || rest === '.fields') {
            node.own.value = message;
            continue;
          }
          if (rest.startsWith('.fields.')) {
            const index = Number(match[1]);
            const scoped = grouped.get(index) ?? blank();
            scoped[rest.slice('.fields.'.length)] = message;
            grouped.set(index, scoped);
            continue;
          }
          if (unplaced === '') unplaced = message;
        }
        live.forEach((node, index) => {
          const leftover = node.form.setErrors(grouped.get(index) ?? blank());
          if (leftover !== '' && unplaced === '') unplaced = leftover;
        });
        nodes.value = nodes.value.map((node) =>
          flagged(node) && !node.$expanded ? { ...node, $expanded: true } : node,
        );
        return unplaced;
      },
      error: () => routed.value,
      errored: () => nodes.value.some(flagged),
      folds: () => listFolds(nodes.value),
      dirty: () => touched.value || nodes.value.some((node) => node.form.dirty()),
      focus() {
        const target = nodes.value.find(flagged) ?? nodes.value[0];
        if (isUndefined(target)) return;
        if (!isUndefined(handle.onReveal)) {
          handle.onReveal(target);
          return;
        }
        if (!target.$expanded) {
          nodes.value = nodes.value.map((node) =>
            node === target ? { ...node, $expanded: true } : node,
          );
        }
        // The expanded body mounts on the reactive flush, so focusing sooner hits a detached input.
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
        const live = nodes.value;
        // Rebasing in place keeps forms, focus, and open rows; a rebuild would drop them.
        const matches =
          items.length === live.length &&
          items.every(
            (item, index) =>
              (isString(item.block) ? item.block : '') === (live[index] as BlockNode).block,
          );
        if (matches) {
          items.forEach((item, index) => {
            const node = live[index] as BlockNode;
            node.uuid = uuidOf(item);
            node.form.rebase(fieldsOf(item));
            node.own.value = '';
          });
          // Readers of `nodes` key on the saved `UUID`s too, so the in-place update must still notify them.
          nodes.value = [...live];
        } else {
          rebuild();
        }
        touched.value = false;
        routed.value = '';
      },
      restore(value) {
        const live = nodes.value;
        const expanded = live.length === 0 || !allCollapsed();
        const pool = [...parked.splice(0), ...live];
        // A live node wins over a parked one with the same identity.
        const known = new Map(pool.map((node) => [node.uuid ?? node.$key, node]));
        const next = itemsOf(value).map((item) => {
          const identity = identityOf(item);
          const node = isUndefined(identity) ? undefined : known.get(identity);
          if (isUndefined(node) || node.block !== item.block) return nodeFor(item, expanded);
          node.own.value = '';
          node.form.restore(fieldsOf(item));
          return node;
        });
        parked.push(...pool.filter((node) => !next.includes(node)));
        nodes.value = next;
        touched.value = !unmoved(next);
        routed.value = '';
        if (!isUndefined(addButton)) focusAfterRestore(live, next, addButton);
      },
    };
    handles.set(control, handle);
    return control;
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
 * The item's `fields`, `{}` when it carries none.
 */
function fieldsOf(item: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : {};
}

/**
 * The node's wire item: its type, its `UUID` when it has one, and `fields` as read.
 */
function itemOf(node: BlockNode, fields: unknown): Record<string, unknown> {
  const item: Record<string, unknown> = { block: node.block };
  if (!isUndefined(node.uuid)) item.UUID = node.uuid;
  item.fields = fields;
  return item;
}

/**
 * The node's drafted item, which carries the node's `$key` in place of a `UUID` it does not have yet.
 */
function draftOf(node: BlockNode): Record<string, unknown> {
  const item = itemOf(node, node.form.draft());
  if (isUndefined(node.uuid)) item.$key = node.$key;
  return item;
}

/**
 * Every block type a stored list holds, at every depth, so the round-trip gate sees them all.
 */
function storedTypes(value: unknown): string[] {
  const names: string[] = [];
  const walk = (items: unknown): void => {
    if (!isArray(items)) return;
    for (const item of items) {
      if (!isPlainObject<Record<string, unknown>>(item)) continue;
      if (isString(item.block)) names.push(item.block);
      const fields = item.fields;
      if (!isPlainObject<Record<string, unknown>>(fields)) continue;
      for (const nested of Object.values(fields)) walk(nested);
    }
  };
  walk(value);
  return names;
}

/**
 * Whether the block type is described and every field below it round-trips.
 */
function editable(name: string, blocks: readonly DashboardBlock[]): boolean {
  const block = blockNamed(blocks, name);
  return isUndefined(block) ? false : itemFormSupports(block.fields, blocks);
}

/**
 * The block type's label in the dashboard language, or its bare name when the discovery read omits the type.
 * The read is reactive, so a caller inside a function child follows the language.
 */
function labelOf(name: string, blocks: readonly DashboardBlock[]): string {
  const block = blockNamed(blocks, name);
  return isUndefined(block) ? name : translateMessage(block.label);
}

/**
 * A fresh error map with no prototype, since subfield names may collide with `Object` keys.
 */
function blank(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

registerUntypedFieldType('blocks', blocksType);
