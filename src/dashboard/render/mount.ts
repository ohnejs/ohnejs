import { append, type Child } from './insert.ts';

/**
 * Mounts a view into a container, replacing whatever it held.
 * A function view binds reactively through `append`.
 *
 * @example
 * ```ts
 * mount(h('h1', null, 'ohne'), document.querySelector('#app')!)
 * ```
 */
export function mount(view: Child, container: Element): void {
  container.replaceChildren();
  append(container, view);
}
