import type { Child } from 'ohnejs/dashboard';

import type { PaletteRowGroup } from './palette-state.ts';

/**
 * What a layer gives each palette slot.
 * `row` lists groups of rows under the results while `paletteView` is `'search'`, read reactively.
 * The palette numbers them with its own rows, so the keyboard walks every row alike.
 * `view` renders in the palette body whatever the view, so a renderer shows itself only under its own view.
 * `footer` renders in a bar under the body, for controls that hold whatever the view.
 * `placeholder` words the search input, read reactively; the first string wins, `null` passes.
 * `tab` offers to take the typed words on the first screen; the first offer shows as a Tab key.
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

  /**
   * The search input's placeholder, or `null` to leave it to the next layer or the palette's own.
   */
  placeholder: () => string | null;

  /**
   * Offers to take the typed words on Tab, or `null` to leave them to the next layer, read reactively.
   */
  tab: (query: string) => PaletteTab | null;
}

/**
 * What a layer does with the typed words on Tab.
 */
export interface PaletteTab {
  /**
   * The Tab key's tooltip, naming what it does.
   */
  label: string;

  /**
   * Takes the words.
   */
  take: () => void;
}

/**
 * A place in the palette a layer fills.
 */
export type PaletteSlot = keyof PaletteSlots;

const registry: { [S in PaletteSlot]: PaletteSlots[S][] } = {
  row: [],
  view: [],
  footer: [],
  placeholder: [],
  tab: [],
};

/**
 * Registers what a layer gives one palette slot.
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
