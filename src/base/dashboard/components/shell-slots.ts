import type { Child } from 'ohnejs/dashboard';

/**
 * A place in the signed-in shell a layer renders into.
 * `header` sits in the header's right cluster, between the content-language switcher and the kebab menu.
 * `status` sits just left of the header's search box, out of the layout, so appearing never moves the header.
 * `global` sits beside the page column on every signed-in page, for overlays and widgets.
 * `loginFields` sits in the sign-in form above its submit button, on the sign-in page and the re-login popup.
 * `login` sits in the same form under its submit button.
 * `overview` sits at the top of the Overview page, above its search box, so a search never hides it.
 */
export type ShellSlot = 'header' | 'status' | 'global' | 'loginFields' | 'login' | 'overview';

const registry: Record<ShellSlot, (() => Child)[]> = {
  header: [],
  status: [],
  global: [],
  loginFields: [],
  login: [],
  overview: [],
};

/**
 * Registers a renderer for one shell slot.
 * A layer's dashboard boot file uses it to add a header action, a global overlay or an Overview notice.
 * Not reactive by design: registration happens at boot, before the shell first renders.
 */
export function registerShellSlot(slot: ShellSlot, render: () => Child): void {
  registry[slot].push(render);
}

/**
 * The renderers registered for `slot`, in registration order.
 * The host calls each inside its own render, so a renderer's effects and cleanup belong to that host.
 */
export function shellSlots(slot: ShellSlot): readonly (() => Child)[] {
  return registry[slot];
}
