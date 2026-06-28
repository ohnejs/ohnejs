import { isArray } from '../utils/is/is-array.ts';
import { isBoolean } from '../utils/is/is-boolean.ts';
import { isFunction } from '../utils/is/is-function.ts';
import { isNullish } from '../utils/is/is-nullish.ts';
import { effect } from '../utils/reactive/effect.ts';

/**
 * A renderable dashboard child.
 *
 * A primitive renders as text; a `Node` is inserted as-is; an array splices its items in order.
 * A function makes the child reactive: it is wrapped in an `effect`.
 * It re-runs as a text binding whenever a value it reads changes.
 */
export type Child =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => string | number | boolean | null | undefined)
  | Child[];

/**
 * Element properties for `h`.
 *
 * An `on*` key binds an event listener.
 * Any other function value is a reactive attribute, re-applied when a value it reads changes.
 * A non-function value sets a static attribute.
 * `false`/`null`/`undefined` removes it; `true` sets it empty; any other value sets its stringified form.
 */
export type Props = Record<string, unknown>;

/**
 * Creates a DOM element, the dashboard's hyperscript primitive.
 *
 * Props bind statically or reactively; children append in order.
 * A function child or attribute value is wrapped in an `effect`.
 * A reactive change patches only the text node or attribute it touches - no re-render, no virtual DOM.
 *
 * @example
 * ```ts
 * const count = ref(0)
 *
 * h('button', { onClick: () => count.value++ }, () => `Count: ${count.value}`)
 * // -> a <button> whose text patches on each click
 * ```
 */
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  for (const child of children) append(el, child);
  return el;
}

function setProps(el: HTMLElement, props: Props): void {
  for (const key in props) {
    const value = props[key];
    if (key.startsWith('on') && isFunction(value)) {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (isFunction(value)) {
      effect(() => setAttribute(el, key, (value as () => unknown)()));
    } else {
      setAttribute(el, key, value);
    }
  }
}

function setAttribute(el: HTMLElement, key: string, value: unknown): void {
  if (isNullish(value) || value === false) el.removeAttribute(key);
  else if (value === true) el.setAttribute(key, '');
  else el.setAttribute(key, String(value));
}

function append(parent: Node, child: Child): void {
  if (isNullish(child) || isBoolean(child)) return;
  if (child instanceof Node) parent.appendChild(child);
  else if (isArray(child)) for (const item of child) append(parent, item);
  else if (isFunction(child)) bindText(parent, child);
  else parent.appendChild(document.createTextNode(String(child)));
}

function bindText(parent: Node, getter: () => string | number | boolean | null | undefined): void {
  const node = document.createTextNode('');
  parent.appendChild(node);
  effect(() => {
    const value = getter();
    node.data = isNullish(value) || isBoolean(value) ? '' : String(value);
  });
}
