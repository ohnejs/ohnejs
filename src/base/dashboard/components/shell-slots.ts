import type { Child } from 'ohnejs/dashboard';

/**
 * A place in the signed-in shell a layer renders into.
 * `header` sits in the header's right cluster, between the content-language switcher and the kebab menu.
 * `status` sits just left of the header's search box, out of the layout, so appearing never moves the header.
 * `global` sits beside the page column on every signed-in page, for overlays and widgets.
 * `login` sits in the sign-in form under its submit button, on the sign-in page and in the re-login popup.
 */
export type ShellSlot = 'header' | 'status' | 'global' | 'login';

const registry: Record<ShellSlot, (() => Child)[]> = {
  header: [],
  status: [],
  global: [],
  login: [],
};

/**
 * Registers a renderer for one shell slot.
 * This is the seam a layer's dashboard boot file uses to add a header action or a global overlay.
 * Not reactive by design: registration happens at boot, before the shell first renders.
 */
export function registerShellSlot(slot: ShellSlot, render: () => Child): void {
  registry[slot].push(render);
}

/**
 * The renderers registered for `slot`, in registration order.
 * The shell calls each inside its own render, so a renderer's effects and cleanup belong to the shell.
 */
export function shellSlots(slot: ShellSlot): readonly (() => Child)[] {
  return registry[slot];
}
