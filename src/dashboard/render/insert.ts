import { isArray } from '../../utils/is/is-array.ts';
import { isBoolean } from '../../utils/is/is-boolean.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { effectScope, type EffectScope } from '../../utils/reactive/effect-scope.ts';

/**
 * A renderable dashboard child.
 *
 * A primitive renders as text; a `Node` is inserted as-is; an array splices its items in order.
 * `null`, `undefined`, and booleans render nothing.
 * A function makes the child reactive: it is bound through `insert`, re-rendering on change.
 * Its return may be any `Child`, so a binding can swap whole nodes, not just patch text.
 */
export type Child = Node | string | number | boolean | null | undefined | (() => Child) | Child[];

/**
 * Appends `child` to `parent`, recursing into arrays and binding a function child reactively.
 * A `Node` is appended as-is; a primitive becomes a text node; nullish and boolean children are skipped.
 */
export function append(parent: Node, child: Child): void {
  if (isNullish(child) || isBoolean(child)) return;
  if (child instanceof Node) parent.appendChild(child);
  else if (isArray(child)) for (const item of child) append(parent, item);
  else if (isFunction(child)) insert(parent, child);
  else parent.appendChild(document.createTextNode(String(child)));
}

/**
 * Binds a reactive region between two comment anchors and keeps it in sync with `getter`.
 *
 * Each run rebuilds the region inside a fresh `effectScope`.
 * Effects from the previous content are disposed before the new content is built.
 * A region holding a single text node is patched in place; otherwise it is cleared and rebuilt.
 */
export function insert(parent: Node, getter: () => Child): void {
  const start = parent.appendChild(document.createComment(''));
  const end = parent.appendChild(document.createComment(''));
  let scope: EffectScope | null = null;
  batchedEffect(() => {
    scope?.dispose();
    scope = effectScope();
    scope.run(() => patch(start, end, getter()));
  });
}

function patch(start: ChildNode, end: ChildNode, value: Child): void {
  const node = start.nextSibling;
  if (node instanceof Text && node.nextSibling === end && (isString(value) || isNumber(value))) {
    node.data = String(value);
    return;
  }
  clearRange(start, end);
  const fragment = document.createDocumentFragment();
  append(fragment, value);
  end.before(fragment);
}

/**
 * Removes every node between the `start` and `end` anchors, leaving the anchors in place.
 */
export function clearRange(start: ChildNode, end: ChildNode): void {
  let node = start.nextSibling;
  while (node && node !== end) {
    node.remove();
    node = start.nextSibling;
  }
}
