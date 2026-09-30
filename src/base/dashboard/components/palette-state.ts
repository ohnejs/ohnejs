import {
  type IconName,
  isUndefined,
  recordHref,
  type Ref,
  ref,
  searchByKeywords,
} from 'ohnejs/utils';

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

  /**
   * The declared dashboard path a record opens at; absent for the record editor.
   */
  recordPath?: string;
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
 * One row a layer adds to the palette: a label and what picking it does.
 */
export interface PaletteRow {
  /**
   * The row label.
   */
  label: string;

  /**
   * The row icon.
   */
  icon?: IconName;

  /**
   * Runs when the row is picked, by Enter or by a click.
   * The palette stays open, so the row may switch `paletteView` or close it itself.
   */
  onSelect: () => void;
}

/**
 * One titled run of rows a layer adds under the results.
 */
export interface PaletteRowGroup {
  /**
   * A key stable across renders, unique among the groups of every layer.
   */
  key: string;

  /**
   * The group heading; `''` for none.
   */
  label: string;

  /**
   * The rows, in order.
   */
  rows: PaletteRow[];
}

/**
 * One row the palette lists: a dashboard path to open, or an action to run.
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
   * The row icon.
   */
  icon?: IconName;

  /**
   * The dashboard path the row opens, once the palette has closed.
   * A hit and a menu row carry one.
   */
  to?: string;

  /**
   * What the row runs instead of opening a path.
   * A layer's row carries one.
   */
  onSelect?: () => void;
}

/**
 * One titled run of rows: the hits of one collection, one sidebar menu group, or a layer's group.
 */
export interface PaletteGroup {
  /**
   * A key stable across renders.
   * It is `collection:` plus the name, `menu:` plus the group index, or the key the layer gave.
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
 * The text the palette searches for: the trimmed query while the search view shows, else `''`.
 * Another view owns the input, so what the person types there never reaches `POST /search`.
 * A command, a query starting with `/`, is no search either.
 * Reactive.
 */
export function paletteSearchTerm(): string {
  if (paletteView.value !== 'search') return '';
  const query = paletteQuery.value.trim();
  return isPaletteCommand(query) ? '' : query;
}

/**
 * Whether `query` is a command: it starts with `/`, and only the layers' rows answer it.
 */
export function isPaletteCommand(query: string): boolean {
  return query.trimStart().startsWith('/');
}

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
 * The rows the palette lists: the hits grouped by collection, the menu rows matching `query`, then `rows`.
 * Hit groups follow the order their first hit arrives in, so the closest match leads.
 * A hit of a collection `collections` does not list is dropped.
 * A blank query lists every menu row; a command lists only `rows`.
 * The rows are numbered across every group, so one selection walks them all.
 */
export function paletteGroups(
  query: string,
  hits: readonly PaletteHit[],
  collections: readonly PaletteCollection[],
  menu: readonly PaletteMenuGroup[],
  rows: readonly PaletteRowGroup[] = [],
): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  const byCollection = new Map<string, PaletteGroup>();
  const command = isPaletteCommand(query);
  for (const hit of command ? [] : hits) {
    const collection = collections.find((candidate) => candidate.name === hit.collection);
    if (isUndefined(collection)) continue;
    let group = byCollection.get(collection.name);
    if (isUndefined(group)) {
      group = { key: `collection:${collection.name}`, label: collection.label, entries: [] };
      byCollection.set(collection.name, group);
      groups.push(group);
    }
    group.entries.push({ index: 0, label: hit.label, to: recordHref(collection, hit.UUID) });
  }
  (command ? [] : menu).forEach((group, at) => {
    const items = searchByKeywords(group.items, query, 'label');
    if (items.length === 0) return;
    const entries = items.map(({ to, label }) => ({ index: 0, label, to }));
    groups.push({ key: `menu:${at}`, label: group.label, entries });
  });
  for (const group of rows) {
    const entries = group.rows.map((row) => ({ index: 0, ...row }));
    groups.push({ key: group.key, label: group.label, entries });
  }
  let index = 0;
  for (const group of groups) for (const entry of group.entries) entry.index = index++;
  return groups;
}
