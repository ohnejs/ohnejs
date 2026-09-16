import type { DashboardBlock } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

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
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { structure, type StructureHandle } from '../../ui/structure.ts';
import { blocksOf } from '../_blocks.ts';
import { blockNamed, itemFormSupports } from '../_items.ts';
import { openBlockPicker } from '../block-picker-popup.ts';
import { clipboardData, stripUUIDs } from '../clipboard.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { structureActions, structureErrorMark, structureItemError } from '../structure-chrome.ts';

/**
 * One editable block instance, carried as a structure item.
 *
 * `$key` is local and monotonic, never the instance `UUID`.
 * A fresh item has no `UUID` yet, and a reordered row must keep its DOM.
 * `uuid` absent is what inserts the item on save.
 * `$expanded` gates only rendering; the form outlives every collapse, so edits survive.
 * A type literal, so the structure's `Record<string, unknown>` item constraint accepts it.
 */
type BlockNode = {
  $key: number;
  $expanded: boolean;
  block: string;
  uuid: string | undefined;
  form: FieldForm;
  own: Ref<string>;
};

// Shared across every blocks control, so a cross-structure drop never lands a colliding `$key`.
let nextNodeKey = 0;

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

    const nodeOf = (item: Readonly<Record<string, unknown>>, expanded: boolean): BlockNode => {
      const key = (nextNodeKey += 1);
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
          onInput: context.onInput,
        }),
      );
      ownForms.add(form);
      return {
        $key: key,
        $expanded: expanded,
        block: name,
        uuid: isString(item.UUID) ? item.UUID : undefined,
        form,
        own: ref(''),
      };
    };

    const baseItems = (): Readonly<Record<string, unknown>>[] =>
      (isArray(base) ? base : []).filter((item) => isPlainObject<Record<string, unknown>>(item));

    const baseNodes = (expanded: boolean): BlockNode[] =>
      baseItems().map((item) => nodeOf(item, expanded));

    const nodes = ref<BlockNode[]>(baseNodes(true));
    const touched = ref(false);
    const routed = ref('');

    const allExpanded = (): boolean => nodes.value.every((node) => node.$expanded);
    const allCollapsed = (): boolean => nodes.value.every((node) => !node.$expanded);
    const flagged = (node: BlockNode): boolean => node.own.value !== '' || node.form.errored();

    const hasFields = (name: string): boolean =>
      (blockNamed(blocks, name)?.fields ?? []).some((field) => field.name !== 'UUID');

    const rebuild = (): void => {
      for (const node of nodes.value) node.form.dispose();
      const expanded = nodes.value.length === 0 || !allCollapsed();
      nodes.value = baseNodes(expanded);
    };

    const change = (next: BlockNode[]): void => {
      nodes.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const valueOf = (form: FieldForm): Record<string, unknown> => {
      const value = stripUUIDs(form.read().value);
      return isPlainObject<Record<string, unknown>>(value) ? value : {};
    };

    const move = (target: BlockNode, delta: -1 | 1): void => {
      const list = [...nodes.value];
      const from = list.indexOf(target);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [node] = list.splice(from, 1);
      list.splice(to, 0, node as BlockNode);
      change(list);
    };

    const addAt = (name: string, at?: number): BlockNode => {
      const node = nodeOf({ block: name }, true);
      const list = nodes.value;
      change(isUndefined(at) ? [...list, node] : [...list.slice(0, at), node, ...list.slice(at)]);
      return node;
    };

    const remove = (target: BlockNode): void => {
      target.form.dispose();
      change(nodes.value.filter((node) => node !== target));
    };

    const duplicate = (target: BlockNode): void => {
      const list = nodes.value;
      const at = list.indexOf(target);
      if (at < 0) return;
      const copy = nodeOf({ block: target.block, fields: valueOf(target.form) }, target.$expanded);
      change([...list.slice(0, at), copy, ...list.slice(at)]);
    };

    const pasteAt = (at: number): void => {
      const payload = clipboardData.value;
      if (isNull(payload) || payload.ohneClipboardDataType !== 'blocks') return;
      const pasted = payload.data.map((item) =>
        nodeOf({ block: item.$key, fields: omit(item, ['$key']) }, true),
      );
      const list = nodes.value;
      change([...list.slice(0, at), ...pasted, ...list.slice(at)]);
    };

    const toggleExpanded = (target: BlockNode): void => {
      nodes.value = nodes.value.map((node) =>
        node === target ? { ...node, $expanded: !node.$expanded } : node,
      );
    };

    const setAllExpanded = (expanded: boolean): void => {
      nodes.value = nodes.value.map((node) => ({ ...node, $expanded: expanded }));
    };

    const settle = (items: BlockNode[]): void => {
      change(
        items.map((item) =>
          ownForms.has(item.form)
            ? item
            : nodeOf({ block: item.block, fields: valueOf(item.form) }, item.$expanded),
        ),
      );
    };

    const focusNew = (node: BlockNode): void => {
      queueMicrotask(() => node.form.focus());
    };

    const pick = (at?: number): void => {
      void openBlockPicker(offered).then((name) => {
        if (!isNull(name)) focusNew(addAt(name, at));
      });
    };

    const element = h(
      'div',
      { tabindex: '-1' },
      structure<BlockNode>(nodes, {
        types: offered,
        resolveItemType: (node) => node.block,
        allowCrossDrop: true,
        disabled: () => off,
        isDraggable: !off,
        dropItemsHereLabel: t('dashboard.dropItemsHere'),
        expose: (handle) => {
          surface = handle;
        },
        header: (node, index) => [
          h('span', { class: 'ohne-muted ohne-truncate' }, () => labelOf(node().block, blocks)),
          off
            ? null
            : structureActions({
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
                        if (offered.length > 1) pick(at);
                        else addAt(offered[0] as string, at);
                      },
                copyPayload: () => ({
                  ohneClipboardDataType: 'blocks',
                  data: [{ $key: node().block, ...valueOf(node().form) }],
                }),
                canPaste: () => {
                  const payload = clipboardData.value;
                  return (
                    !isNull(payload) &&
                    payload.ohneClipboardDataType === 'blocks' &&
                    payload.data.every(({ $key }) => offered.includes($key))
                  );
                },
                onPaste: pasteAt,
                onDuplicate: () => duplicate(node()),
                onRemove: () => remove(node()),
              }),
        ],
        // Untracked reads keep expand-all's replacement from rebuilding the body and dropping focus.
        item: (node) => {
          const form = untracked(() => node().form);
          const name = untracked(() => node().block);
          return h(
            'div',
            { class: 'ohne-blocks-item' },
            hasFields(name)
              ? form.render()
              : h('span', { class: 'ohne-muted' }, () => t('dashboard.noFieldsToDisplay')),
          );
        },
        itemBefore: (node) =>
          structureErrorMark(
            () => node().own.value !== '' || (!node().$expanded && node().form.errored()),
          ),
        itemAfter: (node) => structureItemError(() => node().own.value),
        onCommit: settle,
      }),
      h(
        'div',
        { class: 'ohne-blocks-add' },
        button([icon('plus'), h('span', null, () => t('dashboard.addBlock'))], {
          variant: 'outline',
          disabled: off || offered.length === 0 ? (): boolean => true : undefined,
          onClick: () => {
            if (offered.length > 1) pick();
            else if (offered.length === 1) focusNew(addAt(offered[0] as string));
          },
        }),
      ),
    );

    return {
      element,
      read() {
        const live = nodes.value;
        if (!touched.value && isUndefined(base) && !live.some((node) => node.form.dirty())) {
          return {};
        }
        const errors = blank();
        const items: Record<string, unknown>[] = [];
        live.forEach((node, index) => {
          const reading = node.form.read();
          if (!isUndefined(reading.errors)) {
            for (const [key, message] of Object.entries(reading.errors)) {
              errors[`[${index}].fields${key.startsWith('[') ? key : `.${key}`}`] = message;
            }
            return;
          }
          const item: Record<string, unknown> = { block: node.block };
          if (!isUndefined(node.uuid)) item.UUID = node.uuid;
          item.fields = reading.value ?? {};
          items.push(item);
        });
        if (Object.keys(errors).length > 0) return { errors };
        return { value: items };
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
      dirty: () => touched.value || nodes.value.some((node) => node.form.dirty()),
      focus() {
        const target = nodes.value.find(flagged) ?? nodes.value[0];
        if (isUndefined(target)) return;
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
            node.uuid = isString(item.UUID) ? item.UUID : undefined;
            node.form.rebase(
              isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : {},
            );
            node.own.value = '';
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
 * The block type's label, or its bare name when the discovery read omits the type.
 */
function labelOf(name: string, blocks: readonly DashboardBlock[]): string {
  return blockNamed(blocks, name)?.label ?? name;
}

/**
 * A fresh error map with no prototype, since subfield names may collide with `Object` keys.
 */
function blank(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

registerFieldType('blocks', blocksType);
