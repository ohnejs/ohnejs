import type { Child } from 'ohnejs/dashboard';

import type { PaletteRowGroup } from './palette-state.ts';

/**
 * What a layer gives each palette slot.
 * `row` lists groups of rows under the results while `paletteView` is `'search'`, read reactively.
 * The palette numbers them with its own rows, so the keyboard walks every row alike.
 * `view` renders in the palette body whatever the view, so a renderer shows itself only under its own view.
 * `footer` renders in a bar under the body, for controls that hold whatever the view.
 */
export interface PaletteSlots {
  /**
   * The groups of rows to list, read reactively.
   */
  row: () => PaletteRowGroup[];

  /**
   * The content to render.
   */
  view: () => Child;

  /**
   * The controls to render in the footer bar.
   */
  footer: () => Child;
}

/**
 * A place in the palette a layer fills.
 */
export type PaletteSlot = keyof PaletteSlots;

const registry: { [S in PaletteSlot]: PaletteSlots[S][] } = { row: [], view: [], footer: [] };

/**
 * Registers what a layer gives one palette slot.
 * This is the seam a layer's dashboard boot file uses to add palette rows, a view, or footer controls.
 * Not reactive by design: registration happens at boot, before the palette first opens.
 */
export function registerPaletteSlot<S extends PaletteSlot>(slot: S, give: PaletteSlots[S]): void {
  registry[slot].push(give);
}

/**
 * What is registered for `slot`, in registration order.
 * The palette calls each inside its own render, so a reactive read there belongs to the palette.
 */
export function paletteSlots<S extends PaletteSlot>(slot: S): readonly PaletteSlots[S][] {
  return registry[slot];
}
