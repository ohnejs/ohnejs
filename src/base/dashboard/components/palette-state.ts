import {
  groupBy,
  type IconName,
  isEmpty,
  isUndefined,
  recordHref,
  type Ref,
  ref,
  searchByKeywords,
  searchTokens,
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

  /**
   * The linked records a related hit was found through; a direct hit carries none.
   */
  via?: PaletteVia;
}

/**
 * The linked records of one collection a related hit was found through.
 */
export interface PaletteVia {
  /**
   * The registered name of the collection the linked records belong to.
   */
  collection: string;

  /**
   * Each linked record that matched, in the order of the paths reaching it.
   */
  targets: readonly PaletteTarget[];
}

/**
 * One linked record a related hit was found through.
 */
export interface PaletteTarget {
  /**
   * The linked record's `UUID`.
   */
  UUID: string;

  /**
   * The linked record's label.
   */
  label: string;

  /**
   * The relation field's dot path from the hit's root, naming the block type at each blocks level.
   */
  path: string;
}

/**
 * The slice of a described field the palette words a link path with.
 */
export interface PaletteField {
  /**
   * The field name.
   */
  name: string;

  /**
   * The display label.
   */
  label: string;

  /**
   * The storage kind; a `blocks` field's next path segment names a block type.
   */
  kind: string;

  /**
   * The nested fields of an object or a repeater.
   */
  subfields?: readonly PaletteField[];
}

/**
 * The slice of a described block type the palette words a link path with.
 */
export interface PaletteBlock {
  /**
   * The registered block name.
   */
  name: string;

  /**
   * The display label.
   */
  label: string;

  /**
   * The block's own fields.
   */
  fields: readonly PaletteField[];
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

  /**
   * The top-level fields, which a related hit's link path starts from.
   */
  fields: readonly PaletteField[];
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
 * The slice of the dashboard meta the palette lists rows from.
 */
export interface PaletteMeta {
  /**
   * The collections hits group under.
   */
  collections: readonly PaletteCollection[];

  /**
   * The sidebar menu groups offered as navigation.
   */
  menu: readonly PaletteMenuGroup[];

  /**
   * The block types a link path may pass through.
   */
  blocks: readonly PaletteBlock[];
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
 * The row that pages on through a group's hits.
 */
export interface PaletteMore {
  /**
   * The groups whose hits may go on, by `paletteGroupKey`.
   */
  groups: ReadonlySet<string>;

  /**
   * The row label.
   */
  label: string;

  /**
   * Loads the next hits of `collection`, or of its related group through `via`.
   */
  load: (collection: string, via?: string) => void;
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
   * A muted note at the row's end, with its tooltip.
   * A related hit names the record it links to, and the tooltip the field path that links it.
   */
  hint?: { text: string; tooltip?: string };

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
 * One titled run of rows: a collection's direct or related hits, a sidebar menu group, or a layer's group.
 */
export interface PaletteGroup {
  /**
   * A key stable across renders.
   * It is the `paletteGroupKey` of a hit group, `menu:` plus the group index, or the key the layer gave.
   */
  key: string;

  /**
   * The group heading; `''` for none.
   * A related group's heading is its collection's label, which the palette words together with `via`.
   */
  label: string;

  /**
   * The label of the collection a related group was found through.
   */
  via?: string;

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
 * A command, a query starting with `/`, is no search either, and neither is one `searchTokens` leaves empty.
 * Reactive.
 */
export function paletteSearchTerm(): string {
  if (paletteView.value !== 'search') return '';
  const query = paletteQuery.value.trim();
  return isPaletteCommand(query) || isEmpty(searchTokens(query)) ? '' : query;
}

/**
 * The key of a hit group: `collection:` plus the name, and for a related one `:via:` plus the linked one's.
 * It names the window a "Load more" pages, so each related group pages on its own.
 */
export function paletteGroupKey(collection: string, via?: string): string {
  return isUndefined(via) ? `collection:${collection}` : `collection:${collection}:via:${via}`;
}

/**
 * Words a link path with the labels of the fields and block types along it, joined by `>`.
 * A segment it cannot find stays as written.
 *
 * @example
 * ```ts
 * palettePathLabel('body.Hero.image', fields, blocks) // -> 'Body > Hero > Image'
 * ```
 */
export function palettePathLabel(
  path: string,
  fields: readonly PaletteField[],
  blocks: readonly PaletteBlock[],
): string {
  const labels: string[] = [];
  let scope = fields;
  let block = false;
  for (const segment of path.split('.')) {
    if (block) {
      const found = blocks.find((candidate) => candidate.name === segment);
      labels.push(found?.label ?? segment);
      scope = found?.fields ?? [];
      block = false;
      continue;
    }
    const field = scope.find((candidate) => candidate.name === segment);
    labels.push(field?.label ?? segment);
    scope = field?.subfields ?? [];
    block = field?.kind === 'blocks';
  }
  return labels.join(' > ');
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
 * The rows the palette lists: direct hits, the menu rows matching `query`, related hits, then `rows`.
 * Hits group by `paletteGroupKey`, in the order their first hit arrives in, so the closest match leads.
 * So Enter, which takes the first row, opens a direct hit, else a page, else a related record.
 * A hit of a collection `meta` does not list is dropped, and so is a record its collection already shows.
 * A related row's hint names the record it links to; its tooltip words the path from `meta`'s labels.
 * A blank query lists `rows` first, then every menu row; a command lists only `rows`.
 * With `more`, each hit group that may go on ends in a row loading its next hits.
 * Each row gets a key, so a selection follows its row as rows arrive around it.
 */
export function paletteGroups(
  query: string,
  hits: readonly PaletteHit[],
  meta: PaletteMeta,
  rows: readonly PaletteRowGroup[] = [],
  more?: PaletteMore,
): PaletteGroup[] {
  const command = isPaletteCommand(query);
  const listed = command ? [] : hits;
  const shown = new Set<string>();
  const groups = hitGroups(
    listed.filter((hit) => isUndefined(hit.via)),
    meta,
    shown,
    more,
  );
  const related = hitGroups(
    listed.filter((hit) => !isUndefined(hit.via)),
    meta,
    shown,
    more,
  );
  const layerGroups = rows.map((group) => ({
    key: group.key,
    label: group.label,
    entries: group.rows.map((row) => ({ key: '', ...row })),
  }));
  if (query === '') groups.push(...layerGroups);
  (command ? [] : meta.menu).forEach((group, at) => {
    const items = searchByKeywords(group.items, query, 'label');
    if (items.length === 0) return;
    const entries = items.map(({ to, label }) => ({ key: '', label, to }));
    groups.push({ key: `menu:${at}`, label: group.label, entries });
  });
  groups.push(...related);
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

/**
 * Groups `hits` by `paletteGroupKey`, skipping a record `shown` already holds for its collection.
 * Each record it lists joins `shown`, so a later group never repeats it.
 * A group is created only for a record it lists, so no group holds a lone "Load more".
 */
function hitGroups(
  hits: readonly PaletteHit[],
  meta: PaletteMeta,
  shown: Set<string>,
  more?: PaletteMore,
): PaletteGroup[] {
  const groups = new Map<string, { group: PaletteGroup; collection: string; via?: string }>();
  for (const hit of hits) {
    const collection = meta.collections.find((candidate) => candidate.name === hit.collection);
    const record = `${hit.collection}\n${hit.UUID}`;
    if (isUndefined(collection) || shown.has(record)) continue;
    shown.add(record);
    const via = hit.via?.collection;
    const key = paletteGroupKey(collection.name, via);
    let group = groups.get(key)?.group;
    if (isUndefined(group)) {
      group = { key, label: collection.label, entries: [] };
      if (!isUndefined(via)) {
        group.via = meta.collections.find((candidate) => candidate.name === via)?.label ?? via;
      }
      groups.set(key, { group, collection: collection.name, via });
    }
    const entry: PaletteEntry = { key: '', label: hit.label, to: recordHref(collection, hit.UUID) };
    const hint = isUndefined(hit.via) ? undefined : linkHint(hit.via, collection, meta.blocks);
    if (!isUndefined(hint)) entry.hint = hint;
    group.entries.push(entry);
  }
  if (isUndefined(more)) return [...groups.values()].map(({ group }) => group);
  return [...groups.values()].map(({ group, collection, via }) => {
    if (!more.groups.has(group.key)) return group;
    const onSelect = (): void => more.load(collection, via);
    group.entries.push({ key: '', label: more.label, more: true, onSelect });
    return group;
  });
}

/**
 * The hint of a related row: its first linked record's label, and each link's worded path as the tooltip.
 * With several links, the tooltip names each record before its path.
 */
function linkHint(
  via: PaletteVia,
  collection: PaletteCollection,
  blocks: readonly PaletteBlock[],
): PaletteEntry['hint'] {
  const [first] = via.targets;
  if (isUndefined(first)) return undefined;
  const path = (target: PaletteTarget): string =>
    palettePathLabel(target.path, collection.fields, blocks);
  const byLabel = Object.entries(groupBy(via.targets, (target) => target.label));
  const tooltip =
    via.targets.length === 1
      ? path(first)
      : byLabel
          .map(([label, targets = []]) => `${label}: ${targets.map(path).join(', ')}`)
          .join('\n');
  return { text: first.label, tooltip };
}
