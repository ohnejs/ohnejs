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
   * An instant the row shows at its end, in epoch milliseconds.
   * It reads relative, with the full date and time on hover.
   */
  time?: number;

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
 * The row that pages on through a collection's hits.
 */
export interface PaletteMore {
  /**
   * The collections whose hits may go on, by registered name.
   */
  collections: ReadonlySet<string>;

  /**
   * The row label.
   */
  label: string;

  /**
   * Loads the next hits of `collection`.
   */
  load: (collection: string) => void;
}

/**
 * One row the palette lists: a dashboard path to open, or an action to run.
 */
export interface PaletteEntry {
  /**
   * A key for the row, stable while the row stays listed, which the selection holds.
   * It is the group key plus the row's path or label, with an ordinal on a repeat.
   */
  key: string;

  /**
   * The row label.
   */
  label: string;

  /**
   * The row icon.
   */
  icon?: IconName;

  /**
   * An instant the row shows at its end, in epoch milliseconds.
   */
  time?: number;

  /**
   * Whether the row loads a group's next hits, drawn quieter than a hit.
   */
  more?: boolean;

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
 * The key of the row Enter opens.
 * `''` selects the first row, so the closest hit leads until the person picks a row.
 */
export const paletteActive: Ref<string> = ref('');

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

let opens = 0;

/**
 * Opens the palette where the person left it: the same view, words and selection.
 */
export function openPalette(): void {
  opens += 1;
  paletteOpen.value = true;
}

/**
 * How many times the palette was asked to open, so a closing one can tell it was asked again meanwhile.
 */
export function paletteOpens(): number {
  return opens;
}

/**
 * Returns the palette to where it starts: a blank search.
 */
export function resetPalette(): void {
  paletteView.value = 'search';
  paletteQuery.value = '';
  paletteHits.value = [];
  paletteActive.value = '';
}

/**
 * Closes the palette.
 */
export function closePalette(): void {
  paletteOpen.value = false;
}

/**
 * The position of the selected row among `entries`, or the first row once it is no longer listed.
 */
export function paletteActiveIndex(entries: readonly PaletteEntry[], key: string): number {
  return Math.max(
    0,
    entries.findIndex((entry) => entry.key === key),
  );
}

/**
 * Moves the selection by `step` rows among `entries`, wrapping at either end.
 */
export function movePaletteActive(step: number, entries: readonly PaletteEntry[]): void {
  const count = entries.length;
  if (count === 0) return;
  const at = paletteActiveIndex(entries, paletteActive.value);
  paletteActive.value = entries[(((at + step) % count) + count) % count].key;
}

/**
 * The rows the palette lists: the hits grouped by collection, the menu rows matching `query`, then `rows`.
 * Hit groups follow the order their first hit arrives in, so the closest match leads.
 * A hit of a collection `collections` does not list is dropped.
 * A blank query lists `rows` first, then every menu row; a command lists only `rows`.
 * With `more`, each hit group whose collection may go on ends in a row loading its next hits.
 * Each row gets a key, so a selection follows its row as rows arrive around it.
 */
export function paletteGroups(
  query: string,
  hits: readonly PaletteHit[],
  collections: readonly PaletteCollection[],
  menu: readonly PaletteMenuGroup[],
  rows: readonly PaletteRowGroup[] = [],
  more?: PaletteMore,
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
    group.entries.push({ key: '', label: hit.label, to: recordHref(collection, hit.UUID) });
  }
  for (const [name, group] of byCollection) {
    if (isUndefined(more) || !more.collections.has(name)) continue;
    group.entries.push({
      key: '',
      label: more.label,
      more: true,
      onSelect: () => more.load(name),
    });
  }
  const layerGroups = rows.map((group) => ({
    key: group.key,
    label: group.label,
    entries: group.rows.map((row) => ({ key: '', ...row })),
  }));
  if (query === '') groups.push(...layerGroups);
  (command ? [] : menu).forEach((group, at) => {
    const items = searchByKeywords(group.items, query, 'label');
    if (items.length === 0) return;
    const entries = items.map(({ to, label }) => ({ key: '', label, to }));
    groups.push({ key: `menu:${at}`, label: group.label, entries });
  });
  if (query !== '') groups.push(...layerGroups);
  const seen = new Map<string, number>();
  for (const group of groups) {
    for (const entry of group.entries) {
      const base = `${group.key}\n${entry.to ?? entry.label}`;
      const repeat = seen.get(base) ?? 0;
      seen.set(base, repeat + 1);
      entry.key = repeat === 0 ? base : `${base}\n${repeat}`;
    }
  }
  return groups;
}
