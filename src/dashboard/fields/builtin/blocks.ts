import type { Child } from '../../render/insert.ts';
import type { DashboardBlock, DashboardField } from '../../runtime/meta-types.ts';
import type { ItemForm } from '../item-form.ts';

import { first } from '../../../utils/array/first.ts';
import { last } from '../../../utils/array/last.ts';
import { isArray } from '../../../utils/is/is-array.ts';
import { isEmpty } from '../../../utils/is/is-empty.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { drawer } from '../../ui/drawer.ts';
import { select, type SelectOption } from '../../ui/select.ts';
import { blocksOf } from '../_blocks.ts';
import { blockNamed, carriedField, itemFormSupports } from '../_items.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';
import { createItemForm, scopedErrors } from '../item-form.ts';

/**
 * One editable block instance: its type, the instance it keeps, and the lists below it.
 *
 * `key` is local and monotonic, never the instance `UUID`.
 * A fresh item has no `UUID` yet, and a reordered row must keep its DOM.
 * `uuid` absent is what inserts the item on save.
 */
interface BlockNode {
  key: number;
  block: string;
  uuid: string | undefined;
  form: ItemForm;
  lists: readonly BlockList[];
  error: Ref<string>;
}

/**
 * One `blocks` list under a node: the subfield it fills and the nodes it holds, in order.
 */
interface BlockList {
  field: DashboardField;
  nodes: Ref<readonly BlockNode[]>;
}

css`
  .ohne-blocks-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    border-top: 1px solid var(--hairline);
  }

  .ohne-blocks-name {
    margin-right: auto;
  }

  .ohne-blocks-flag {
    margin-left: 6px;
    color: var(--danger);
  }

  .ohne-blocks-empty {
    padding: 6px 0;
    border-top: 1px solid var(--hairline);
  }

  .ohne-blocks-add {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }

  .ohne-blocks-trail,
  .ohne-blocks-sub-label {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
  }

  .ohne-blocks-trail {
    margin-bottom: 20px;
  }

  .ohne-blocks-sub {
    margin-top: 24px;
  }
`;

/**
 * The `blocks` field's sheet cell: a dim count of the items.
 *
 * Editing opens one drawer that walks the list.
 * A row opens its item, and an item's own `blocks` subfields list their rows in turn.
 * Depth is navigated rather than stacked: the wire nests without limit, a fixed drawer cannot.
 * Saving writes the whole list once: an item keeps its `UUID`, and anything left out is deleted.
 */
export const blocksCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
  editor(context) {
    const t = useT();
    const blocks = blocksOf();
    let nextKey = 0;
    const keyed = (): number => (nextKey += 1);

    const root = ref<readonly BlockNode[]>(nodesOf(context.value(), blocks, keyed));
    const trail = ref<readonly BlockNode[]>([]);
    const busy = ref(false);
    const failure = ref('');

    // A whole-list write must resubmit every item, so one type it cannot rebuild locks the field.
    // The stored list decides this once: the picker only ever offers types that do round-trip.
    const locked = !stored(root.value).every((name) => editable(name, blocks));
    const offered = (context.field.allow ?? []).filter((name) => editable(name, blocks));

    const save = (event: SubmitEvent): void => {
      event.preventDefault();
      if (busy.value || locked) return;
      const sent = root.value;
      const items = serialize(sent);
      if (isUndefined(items)) {
        failure.value = '';
        return;
      }
      busy.value = true;
      failure.value = '';
      void context.commit(items).then((landing) => {
        busy.value = false;
        if (landing.landed) return;
        if (isUndefined(landing.errors)) {
          failure.value = t('dashboard.writeFailed');
          return;
        }
        const placed = route(sent, context.field.name, landing.errors);
        failure.value = placed ? '' : (first(Object.values(landing.errors)) ?? '');
      });
    };

    const rows = (nodes: Ref<readonly BlockNode[]>): Child => [
      each(
        () => nodes.value,
        (node) => node.key,
        (node, index) =>
          h(
            'div',
            { class: 'ohne-blocks-row' },
            h('span', { class: 'ohne-caps' }, () => String(index() + 1)),
            h(
              'span',
              { class: 'ohne-blocks-name' },
              button(() => labelOf(node().block, blocks), {
                kind: 'ghost',
                disabled: () => busy.value,
                onClick: () => {
                  trail.value = [...trail.value, node()];
                },
              }),
              () => (flagged(node()) ? h('span', { class: 'ohne-blocks-flag' }, '!') : null),
            ),
            button('↑', {
              kind: 'ghost',
              disabled: () => busy.value || index() === 0,
              onClick: () => move(nodes, node().key, -1),
            }),
            button('↓', {
              kind: 'ghost',
              disabled: () => busy.value || index() === nodes.value.length - 1,
              onClick: () => move(nodes, node().key, 1),
            }),
            button('✕', {
              kind: 'ghost',
              disabled: () => busy.value,
              onClick: () => {
                nodes.value = nodes.value.filter((entry) => entry.key !== node().key);
              },
            }),
          ),
      ),
      () =>
        nodes.value.length === 0 ? h('div', { class: 'ohne-blocks-empty' }, dimMark('·')) : null,
    ];

    const adder = (nodes: Ref<readonly BlockNode[]>, types: readonly string[]): Child => {
      if (types.length === 0) return null;
      const choice = ref(first(types) ?? '');
      return h(
        'div',
        { class: 'ohne-blocks-add' },
        select(
          choice,
          () => types.map((name): SelectOption => ({ value: name, label: labelOf(name, blocks) })),
          () => busy.value,
        ),
        button(() => t('dashboard.addBlock'), {
          kind: 'ghost',
          disabled: () => busy.value,
          onClick: () => {
            nodes.value = [...nodes.value, nodeOf({ block: choice.value }, blocks, keyed)];
          },
        }),
      );
    };

    const list = (nodes: Ref<readonly BlockNode[]>, types: readonly string[]): Child => [
      rows(nodes),
      adder(nodes, types),
    ];

    const item = (node: BlockNode): Child => [
      node.form.render(),
      () =>
        node.error.value === '' ? null : h('div', { class: 'ohne-item-failure' }, node.error.value),
      node.lists.map((sub) =>
        h(
          'div',
          { class: 'ohne-blocks-sub' },
          h('div', { class: 'ohne-blocks-sub-label' }, sub.field.label),
          list(
            sub.nodes,
            (sub.field.allow ?? []).filter((name) => editable(name, blocks)),
          ),
        ),
      ),
    ];

    const up = (): void => {
      if (trail.value.length === 0) context.cancel();
      else trail.value = trail.value.slice(0, -1);
    };

    return drawer(
      { title: () => context.field.label, onClose: up },
      h(
        'form',
        { onSubmit: save },
        () =>
          trail.value.length === 0
            ? null
            : h(
                'div',
                { class: 'ohne-blocks-trail' },
                button(context.field.label, {
                  kind: 'ghost',
                  onClick: () => {
                    trail.value = [];
                  },
                }),
                trail.value.map((node, depth) => [
                  ' / ',
                  button(labelOf(node.block, blocks), {
                    kind: 'ghost',
                    onClick: () => {
                      trail.value = trail.value.slice(0, depth + 1);
                    },
                  }),
                ]),
              ),
        locked
          ? h('div', { class: 'ohne-item-failure' }, t('dashboard.blocksLocked'))
          : () => {
              const open = last(trail.value);
              return isUndefined(open) ? list(root, offered) : item(open);
            },
        h('div', { class: 'ohne-item-failure' }, () => failure.value),
        h(
          'div',
          { class: 'ohne-item-actions' },
          button(() => t('dashboard.save'), {
            type: 'submit',
            disabled: () => busy.value || locked,
          }),
        ),
      ),
    );
  },
};

registerFieldCell('blocks', blocksCell);

/**
 * The nodes one stored list edits into, malformed items skipped.
 */
function nodesOf(
  value: unknown,
  blocks: readonly DashboardBlock[],
  keyed: () => number,
): readonly BlockNode[] {
  if (!isArray(value)) return [];
  return value
    .filter((entry) => isPlainObject<Record<string, unknown>>(entry))
    .map((entry) => nodeOf(entry, blocks, keyed));
}

/**
 * One node over a stored item: a form on the block's own fields, a list per `blocks` subfield.
 *
 * The form is seeded from `fields` alone and never attaches a `UUID`.
 * A block item carries its instance on the envelope beside `block`, never inside `fields`.
 */
function nodeOf(
  item: Readonly<Record<string, unknown>>,
  blocks: readonly DashboardBlock[],
  keyed: () => number,
): BlockNode {
  const name = isString(item.block) ? item.block : '';
  const own = blockNamed(blocks, name)?.fields ?? [];
  const fields = isPlainObject<Record<string, unknown>>(item.fields) ? item.fields : {};
  return {
    key: keyed(),
    block: name,
    uuid: isString(item.UUID) ? item.UUID : undefined,
    form: createItemForm(own, fields, { attachUUID: false }),
    lists: own
      .filter((field) => field.kind === 'blocks' && carriedField(field))
      .map((field) => ({ field, nodes: ref(nodesOf(fields[field.name], blocks, keyed)) })),
    error: ref(''),
  };
}

/**
 * The whole list as the wire takes it, or `undefined` once any form below it failed to parse.
 * Every form is read either way, so each bad row is marked before the write is abandoned.
 */
function serialize(nodes: readonly BlockNode[]): Record<string, unknown>[] | undefined {
  const items: Record<string, unknown>[] = [];
  let ok = true;
  for (const node of nodes) {
    const fields = node.form.read();
    if (isUndefined(fields)) ok = false;
    for (const list of node.lists) {
      const nested = serialize(list.nodes.value);
      if (isUndefined(nested)) ok = false;
      else if (!isUndefined(fields)) fields[list.field.name] = nested;
    }
    if (isUndefined(fields)) continue;
    const item: Record<string, unknown> = { block: node.block, fields };
    if (!isUndefined(node.uuid)) item.UUID = node.uuid;
    items.push(item);
  }
  return ok ? items : undefined;
}

/**
 * Routes a `422` onto the nodes it names, answering whether anything landed at all.
 *
 * The server keys an item's own failures under `<path>[<i>].fields.`.
 * Its envelope keys at `<path>[<i>]`, `.block`, `.UUID` and `.fields`.
 * A nested list keys one level deeper again.
 * A message no row and no nested list can claim becomes that node's own line.
 * A path the grammar does not predict is therefore read rather than stored unseen.
 */
function route(
  nodes: readonly BlockNode[],
  path: string,
  errors: Readonly<Record<string, string>>,
): boolean {
  let placed = false;
  nodes.forEach((node, index) => {
    const at = `${path}[${index}]`;
    const envelope =
      errors[at] ?? errors[`${at}.block`] ?? errors[`${at}.UUID`] ?? errors[`${at}.fields`] ?? '';
    const owned: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, message] of Object.entries(scopedErrors(errors, `${at}.fields.`))) {
      if (node.lists.some((list) => key.startsWith(`${list.field.name}[`))) continue;
      owned[key] = message;
    }
    const leftover = node.form.setErrors(owned);
    node.error.value = envelope === '' ? leftover : envelope;
    if (envelope !== '' || !isEmpty(owned)) placed = true;
    for (const list of node.lists) {
      if (route(list.nodes.value, `${at}.fields.${list.field.name}`, errors)) placed = true;
    }
  });
  return placed;
}

/**
 * Whether the node or anything beneath it carries a message, so a row can point deeper.
 */
function flagged(node: BlockNode): boolean {
  if (node.error.value !== '' || node.form.errored()) return true;
  return node.lists.some((list) => list.nodes.value.some(flagged));
}

/**
 * Every block type the list holds, at every depth.
 */
function stored(nodes: readonly BlockNode[]): string[] {
  const names: string[] = [];
  for (const node of nodes) {
    names.push(node.block);
    for (const list of node.lists) names.push(...stored(list.nodes.value));
  }
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
 * Moves the keyed node one place, clamped to the list.
 */
function move(nodes: Ref<readonly BlockNode[]>, key: number, delta: -1 | 1): void {
  const list = [...nodes.value];
  const from = list.findIndex((entry) => entry.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  const [entry] = list.splice(from, 1);
  list.splice(to, 0, entry as BlockNode);
  nodes.value = list;
}
