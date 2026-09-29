import type { Child } from 'ohnejs/dashboard';

/**
 * A place in the palette a layer renders into.
 * `row` sits below the results while `paletteView` is `'search'`, for an action on the typed query.
 * `view` sits in the palette body whatever the view, so a renderer shows itself only under its own view.
 */
export type PaletteSlot = 'row' | 'view';

const registry: Record<PaletteSlot, (() => Child)[]> = { row: [], view: [] };

/**
 * Registers a renderer for one palette slot.
 * This is the seam a layer's dashboard boot file uses to add a palette row or a palette view.
 * Not reactive by design: registration happens at boot, before the palette first opens.
 */
export function registerPaletteSlot(slot: PaletteSlot, render: () => Child): void {
  registry[slot].push(render);
}

/**
 * The renderers registered for `slot`, in registration order.
 * The palette calls each inside its own render, so a renderer's effects and cleanup belong to the palette.
 */
export function paletteSlots(slot: PaletteSlot): readonly (() => Child)[] {
  return registry[slot];
}
