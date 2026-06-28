/**
 * Mounts a view into a container, replacing whatever it held.
 *
 * @example
 * ```ts
 * mount(h('h1', null, 'ohne'), document.querySelector('#app')!)
 * ```
 */
export function mount(view: Node, container: Element): void {
  container.replaceChildren(view);
}
