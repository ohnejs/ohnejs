import { isUndefined, type Ref, ref, searchByKeywords } from 'ohnejs/utils';

/**
 * One record `POST /search` found, its label already filled for display.
 */
export interface PaletteHit {
  /**
   * The registered collection name, in PascalCase.
   */
  collection: string;

  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The label the palette shows.
   */
  label: string;
}

/**
 * The slice of a described collection the palette groups hits under.
 * A structural subset, so this module stays free of the browser-only dashboard types.
 */
export interface PaletteCollection {
  /**
   * The registered collection name.
   */
  name: string;

  /**
   * The display label.
   */
  label: string;

  /**
   * The URL segment under `/collections/`.
   */
  segment: string;
}

/**
 * The slice of a sidebar menu group the palette offers as navigation.
 */
export interface PaletteMenuGroup {
  /**
   * The group heading; `''` for none.
   */
  label: string;

  /**
   * The rows, each a dashboard path and its label.
   */
  items: readonly { to: string; label: string }[];
}

/**
 * One row the palette lists: a dashboard path to open.
 */
export interface PaletteEntry {
  /**
   * The row's position across every group, which the keyboard selection counts in.
   */
  index: number;

  /**
   * The row label.
   */
  label: string;

  /**
   * The dashboard path the row opens.
   */
  to: string;
}

/**
 * One titled run of rows: the hits of one collection, or one sidebar menu group.
 */
export interface PaletteGroup {
  /**
   * A key stable across renders: `collection:` plus the name, or `menu:` plus the group index.
   */
  key: string;

  /**
   * The group heading; `''` for none.
   */
  label: string;

  /**
   * The rows, in order.
   */
  entries: PaletteEntry[];
}

/**
 * The view the palette body shows while open.
 * `'search'` lists the results; a layer that registers a `view` slot may switch to its own.
 */
export const paletteView: Ref<string> = ref('search');

/**
 * Whether the palette is open.
 */
export const paletteOpen: Ref<boolean> = ref(false);

/**
 * The text the palette's input holds.
 */
export const paletteQuery: Ref<string> = ref('');

/**
 * The records the last answered search found for the current query.
 */
export const paletteHits: Ref<readonly PaletteHit[]> = ref([]);

/**
 * The index of the row Enter opens, across every group.
 */
export const paletteActive: Ref<number> = ref(0);

/**
 * Opens the palette on a blank search.
 */
export function openPalette(): void {
  paletteView.value = 'search';
  paletteQuery.value = '';
  paletteHits.value = [];
  paletteActive.value = 0;
  paletteOpen.value = true;
}

/**
 * Closes the palette.
 */
export function closePalette(): void {
  paletteOpen.value = false;
}

/**
 * Moves the selection by `step` rows among `count`, wrapping at either end.
 */
export function movePaletteActive(step: number, count: number): void {
  if (count === 0) return;
  paletteActive.value = (((paletteActive.value + step) % count) + count) % count;
}

/**
 * The rows the palette lists: the hits grouped by collection, then the menu rows matching `query`.
 * Hit groups follow the order their first hit arrives in, so the closest match leads.
 * A hit of a collection `collections` does not list is dropped.
 * A blank query lists every menu row.
 */
export function paletteGroups(
  query: string,
  hits: readonly PaletteHit[],
  collections: readonly PaletteCollection[],
  menu: readonly PaletteMenuGroup[],
): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  const byCollection = new Map<string, PaletteGroup>();
  for (const hit of hits) {
    const collection = collections.find((candidate) => candidate.name === hit.collection);
    if (isUndefined(collection)) continue;
    let group = byCollection.get(collection.name);
    if (isUndefined(group)) {
      group = { key: `collection:${collection.name}`, label: collection.label, entries: [] };
      byCollection.set(collection.name, group);
      groups.push(group);
    }
    const to = `/collections/${collection.segment}/${hit.UUID}`;
    group.entries.push({ index: 0, label: hit.label, to });
  }
  menu.forEach((group, at) => {
    const items = searchByKeywords(group.items, query, 'label');
    if (items.length === 0) return;
    const entries = items.map(({ to, label }) => ({ index: 0, label, to }));
    groups.push({ key: `menu:${at}`, label: group.label, entries });
  });
  let index = 0;
  for (const group of groups) for (const entry of group.entries) entry.index = index++;
  return groups;
}
