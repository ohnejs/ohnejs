import { reconcile } from '../../utils/array/reconcile.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { effectScope, type EffectScope } from '../../utils/reactive/effect-scope.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { append, type Child, clearRange } from './insert.ts';

interface Row<T> {
  scope: EffectScope;
  start: ChildNode;
  end: ChildNode;
  item: Ref<T>;
  index: Ref<number>;
}

/**
 * Renders a keyed list that reconciles in place as `items` changes.
 *
 * `key` returns a stable, unique key per item, so a row keeps its DOM and state across moves.
 * `render` receives reactive accessors: a row whose item or position changes updates without a rebuild.
 *
 * @example
 * ```ts
 * const todos = ref([{ id: 1, text: 'buy milk' }])
 *
 * each(
 *   () => todos.value,
 *   (todo) => todo.id,
 *   (todo) => h('li', null, () => todo().text),
 * )
 * ```
 */
export function each<T, K>(
  items: () => readonly T[],
  key: (item: T, index: number) => K,
  render: (item: () => T, index: () => number) => Child,
): Child {
  const fragment = document.createDocumentFragment();
  const end = fragment.appendChild(document.createComment(''));
  const rows = new Map<K, Row<T>>();
  let order: K[] = [];

  const make = (value: T, position: number): Row<T> => {
    const item = ref(value);
    const index = ref(position);
    const piece = document.createDocumentFragment();
    const rowStart = piece.appendChild(document.createComment(''));
    const scope = effectScope();
    scope.run(() =>
      untracked(() =>
        append(
          piece,
          render(
            () => item.value,
            () => index.value,
          ),
        ),
      ),
    );
    const rowEnd = piece.appendChild(document.createComment(''));
    return { scope, start: rowStart, end: rowEnd, item, index };
  };

  const patch = (list: readonly T[], keys: K[]): void => {
    const next = new Set(keys);

    for (const [k, row] of rows) {
      if (next.has(k)) continue;
      row.scope.dispose();
      clearRange(row.start, row.end);
      row.start.remove();
      row.end.remove();
      rows.delete(k);
    }

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] as K;
      const row = rows.get(k);
      if (row) {
        row.item.value = list[i] as T;
        row.index.value = i;
      } else {
        rows.set(k, make(list[i] as T, i));
      }
    }

    for (const step of reconcile(order, keys)) {
      if (step.op === 'remove') continue;
      const before = isNull(step.before) ? end : (rows.get(step.before) as Row<T>).start;
      const row = rows.get(step.key) as Row<T>;
      moveRange(row.start, row.end, before);
    }

    order = keys;
  };

  batchedEffect(() => {
    const list = items();
    const keys = list.map((value, i) => key(value, i));
    // Removing a focused node fires `blur` at once, so the patch must not subscribe to what a handler reads.
    untracked(() => patch(list, keys));
  });

  return fragment;
}

/**
 * Moves the nodes from `start` through `end` in front of `before`, or nothing when `before` is detached.
 * A row already in the document moves with `moveBefore` where the browser has it, so focus inside it stays.
 */
function moveRange(start: ChildNode, end: ChildNode, before: ChildNode): void {
  const parent = before.parentNode;
  if (isNull(parent)) return;
  const preserve = parent.isConnected && start.isConnected && 'moveBefore' in parent;
  let node: ChildNode | null = start;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    const last = node === end;
    if (preserve) parent.moveBefore(node, before);
    else parent.insertBefore(node, before);
    if (last) break;
    node = next;
  }
}
