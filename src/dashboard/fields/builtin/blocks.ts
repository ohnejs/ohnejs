import type { Child } from '../../render/insert.ts';
import type { DashboardBlock } from '../../runtime/meta-types.ts';
import type { FieldForm } from '../field-form.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { when } from '../../render/when.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { blocksOf } from '../_blocks.ts';
import { blockNamed, itemFormSupports } from '../_items.ts';
import { openBlockPicker } from '../block-picker-popup.ts';
import { createFieldForm } from '../field-form.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * One editable block instance.
 *
 * `key` is local and monotonic, never the instance `UUID`.
 * A fresh item has no `UUID` yet, and a reordered row must keep its DOM.
 * `uuid` absent is what inserts the item on save.
 * `open` gates only rendering; the form outlives every collapse, so edits survive.
 */
interface BlockNode {
  key: number;
  block: string;
  uuid: string | undefined;
  seed: Ref<Readonly<Record<string, unknown>>>;
  form: FieldForm;
  open: Ref<boolean>;
  own: Ref<string>;
}

css`
  .ohne-blocks-node + .ohne-blocks-node {
    margin-top: var(--s1);
  }

  .ohne-blocks-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: 28px;
    padding: 0 var(--s1);
    border-radius: var(--radius);
    cursor: default;
  }

  .ohne-blocks-row:hover {
    background: var(--surface);
  }

  .ohne-blocks-row .ohne-icon {
    color: var(--dim);
    transition: transform var(--pace);
  }

  .ohne-blocks-row.closed .ohne-icon.ohne-blocks-chevron {
    transform: rotate(-90deg);
  }

  .ohne-blocks-summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--dim);
  }

  .ohne-blocks-mark {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--danger);
  }

  .ohne-blocks-body {
    margin: var(--s2) 0 var(--s3) var(--s3);
    padding: var(--s3) var(--s4) var(--s4);
    border: 1px solid var(--line);
    border-left: 2px solid var(--line-strong);
    border-radius: var(--radius);
  }

  .ohne-blocks-own {
    margin-bottom: var(--s2);
    font-size: var(--fs-small);
    color: var(--danger);
  }

  .ohne-blocks-add {
    margin-top: var(--s2);
  }
`;

/**
 * The `blocks` field's dashboard behaviour.
 *
 * Cells summarize the list as the first block's type label plus a dim `+n` tail.
 * There is no inline cell editor: the list edits on the record page as collapsible rows, one per block.
 * Each row expands into its item form in place.
 * Nested `blocks` subfields recurse through this same control, so depth costs one indent per level.
 * The record's one save writes the whole list: an item keeps its `UUID`, and anything left out is deleted.
 *
 * A stored type the registry cannot round-trip refuses the control.
 * The field then falls back to a locked read-only row and the stored value carries through untouched.
 */
export const blocksType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      const items = isArray(current) ? current : [];
      if (items.length === 0) return dimMark('·');
      const first = items[0];
      const name =
        isPlainObject<Record<string, unknown>>(first) && isString(first.block) ? first.block : '';
      return [
        labelOf(name, blocksOf()),
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

    let base = context.initial;
    let nextKey = 0;
    // Later nodes are built from event handlers where no scope is active; the owner catches them,
    // so the record surface's teardown releases their effects too.
    const owner = effectScope();

    const nodeOf = (item: Readonly<Record<string, unknown>>, open: boolean): BlockNode => {
      const key = (nextKey += 1);
      const name = isString(item.block) ? item.block : '';
      // A fresh item has no `fields` yet; seeding its form `undefined` keeps immutable subfields
      // settable, exactly as a new record does.
      const fields = isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : undefined;
      return {
        key,
        block: name,
        uuid: isString(item.UUID) ? item.UUID : undefined,
        seed: ref<Readonly<Record<string, unknown>>>(fields ?? {}),
        form: owner.run(() =>
          createFieldForm(blockNamed(blocks, name)?.fields ?? [], fields, {
            mode: context.mode,
            path: `${context.path}[${key}].fields`,
            language: context.language,
            onInput: context.onInput,
          }),
        ),
        open: ref(open),
        own: ref(''),
      };
    };

    const baseNodes = (): readonly BlockNode[] =>
      (isArray(base) ? base : [])
        .filter((item) => isPlainObject<Record<string, unknown>>(item))
        .map((item) => nodeOf(item, false));

    const nodes = ref<readonly BlockNode[]>(baseNodes());
    const touched = ref(false);
    const routed = ref('');

    const baseItems = (): Readonly<Record<string, unknown>>[] =>
      (isArray(base) ? base : []).filter((item) => isPlainObject<Record<string, unknown>>(item));

    const rebuild = (): void => {
      for (const node of nodes.value) node.form.dispose();
      nodes.value = baseNodes();
    };

    const change = (next: readonly BlockNode[]): void => {
      nodes.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    const move = (key: number, delta: -1 | 1): void => {
      const list = [...nodes.value];
      const from = list.findIndex((node) => node.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [node] = list.splice(from, 1);
      list.splice(to, 0, node as BlockNode);
      change(list);
    };

    const add = (name: string): void => {
      const node = nodeOf({ block: name }, true);
      change([...nodes.value, node]);
      queueMicrotask(() => node.form.focus());
    };

    const flagged = (node: BlockNode): boolean => node.own.value !== '' || node.form.errored();

    const element = h(
      'div',
      { tabindex: '-1' },
      each(
        () => nodes.value,
        (node) => node.key,
        (node, index) => blockRow(node, index, nodes, move, change, flagged, t, blocks),
      ),
      offered.length > 0 ? adder(offered, add, t) : null,
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
          if (flagged(node)) node.open.value = true;
        });
        return unplaced;
      },
      error: () => routed.value,
      errored: () => nodes.value.some(flagged),
      dirty: () => touched.value || nodes.value.some((node) => node.form.dirty()),
      focus() {
        const errored = nodes.value.find(flagged);
        if (!isUndefined(errored)) {
          errored.open.value = true;
          // The expanded body mounts on the reactive flush's microtask; focusing before it would
          // land on a detached input.
          queueMicrotask(() => {
            if (!errored.form.focusError()) errored.form.focus();
          });
          return;
        }
        nodes.value[0]?.form.focus();
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
        // A matching answer rebases each node in place, keeping forms, focus, and open rows;
        // fresh items pick up the `UUID` the server minted.
        const matches =
          items.length === live.length &&
          items.every(
            (item, index) =>
              (isString(item.block) ? item.block : '') === (live[index] as BlockNode).block,
          );
        if (matches) {
          items.forEach((item, index) => {
            const node = live[index] as BlockNode;
            const fields = isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : {};
            node.uuid = isString(item.UUID) ? item.UUID : undefined;
            node.seed.value = fields;
            node.form.rebase(fields);
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
 * One block's row and, while open, its item form in an indented card.
 */
function blockRow(
  node: () => BlockNode,
  index: () => number,
  nodes: Ref<readonly BlockNode[]>,
  move: (key: number, delta: -1 | 1) => void,
  change: (next: readonly BlockNode[]) => void,
  flagged: (node: BlockNode) => boolean,
  t: (key: 'dashboard.removeItem') => string,
  blocks: readonly DashboardBlock[],
): Child {
  const toggle = (): void => {
    node().open.value = !node().open.value;
  };
  const chevron = icon('chevron-down');
  chevron.classList.add('ohne-blocks-chevron');
  return h(
    'div',
    { class: 'ohne-blocks-node' },
    h(
      'div',
      {
        class: () => `ohne-blocks-row${node().open.value ? '' : ' closed'}`,
        role: 'button',
        tabindex: '0',
        'aria-expanded': () => (node().open.value ? 'true' : 'false'),
        onClick: (event: MouseEvent) => {
          const target = event.target;
          if (target instanceof Element && !isNull(target.closest('button'))) return;
          toggle();
        },
        onKeydown: (event: KeyboardEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        },
      },
      chevron,
      h('span', { class: 'ohne-caps' }, () => String(index() + 1)),
      h('span', { class: 'ohne-caps' }, () => labelOf(node().block, blocks)),
      h('span', { class: 'ohne-blocks-summary' }, () => summaryOf(node(), blocks)),
      () => (flagged(node()) ? h('span', { class: 'ohne-blocks-mark' }) : null),
      button('↑', {
        variant: 'ghost',
        disabled: () => index() === 0,
        onClick: () => move(node().key, -1),
      }),
      button('↓', {
        variant: 'ghost',
        disabled: () => index() === nodes.value.length - 1,
        onClick: () => move(node().key, 1),
      }),
      button('✕', {
        variant: 'ghost',
        ariaLabel: t('dashboard.removeItem'),
        onClick: () => {
          node().form.dispose();
          change(nodes.value.filter((live) => live.key !== node().key));
        },
      }),
    ),
    when(
      () => node().open.value,
      () =>
        h(
          'div',
          { class: 'ohne-blocks-body' },
          () =>
            node().own.value === ''
              ? null
              : h('div', { class: 'ohne-blocks-own' }, node().own.value),
          node().form.render(),
        ),
    ),
  );
}

/**
 * The add affordance: one admitted type adds directly, several open the block picker popup.
 */
function adder(
  offered: readonly string[],
  add: (name: string) => void,
  t: (key: 'dashboard.addBlock') => string,
): Child {
  const onClick =
    offered.length === 1
      ? () => add(offered[0] as string)
      : () => {
          void openBlockPicker(offered).then((name) => {
            if (!isNull(name)) add(name);
          });
        };
  return h(
    'div',
    { class: 'ohne-blocks-add' },
    button(() => `+ ${t('dashboard.addBlock')}`, { variant: 'ghost', onClick }),
  );
}

/**
 * The row's summary: the seed's first non-empty text subfield, stale until the next save.
 */
function summaryOf(node: BlockNode, blocks: readonly DashboardBlock[]): string {
  const fields = blockNamed(blocks, node.block)?.fields ?? [];
  for (const field of fields) {
    if (field.logicalType !== 'text' || field.type === 'password' || !field.readable) continue;
    const value = node.seed.value[field.name];
    if (isString(value) && value !== '') return value;
  }
  return '';
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
