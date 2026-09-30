import {
  api,
  attachTooltip,
  type Child,
  css,
  dashboardMeta,
  each,
  fallbackLabel,
  formatDateTime,
  formatRelative,
  h,
  icon,
  hasModifierKey,
  navigate,
  type Popup,
  popup,
  useT,
  verticalMenu,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  debounce,
  groupBy,
  effect,
  isComposing,
  isEmpty,
  isNull,
  isNullish,
  isString,
  isUndefined,
  nextTick,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import { type PaletteTab, paletteSlots } from './palette-slots.ts';
import {
  closePalette,
  movePaletteActive,
  openPalette,
  type PaletteEntry,
  type PaletteHit,
  paletteActive,
  paletteActiveIndex,
  paletteGroups,
  paletteHits,
  paletteOpens,
  paletteOpen,
  paletteQuery,
  paletteSearchTerm,
  paletteView,
  resetPalette,
} from './palette-state.ts';
import { searchInput } from './search-input.ts';

/**
 * The hits a search answers per collection, and each page a "Load more" adds.
 */
const PAGE = 5;

css`
  .o-palette-tab {
    display: inline-flex;
    align-items: center;
    height: 1.25rem;
    margin-right: 0.25rem;
    padding: 0 0.3125rem;
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: hsl(var(--ohne-muted-foreground));
    font-family: var(--ohne-font);
    font-size: 0.6875rem;
    line-height: 1;
  }

  .o-palette-tab:hover {
    background-color: hsl(var(--ohne-muted) / 0.6);
    color: hsl(var(--ohne-foreground));
  }

  .o-palette-tab:focus-visible {
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .o-palette-tab > kbd {
    font: inherit;
  }
`;

css`
  .o-palette .ohne-popup-container {
    max-height: min(40rem, calc(100% - 12dvh));
    margin-top: 12dvh;
  }

  .o-palette .ohne-popup-footer {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: flex-end;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .o-palette-results {
    display: flex;
    flex-direction: column;
    gap: 0.75em;
  }

  .o-palette-results > .ohne-vertical-menu + .ohne-vertical-menu {
    padding-top: 0.75em;
    border-top: 1px solid hsl(var(--ohne-border));
  }

  .o-palette-results .ohne-vertical-menu-item-button:has(> .o-palette-more) {
    justify-content: center;
    gap: 0.25em;
  }

  .o-palette-results .o-palette-more {
    order: 1;
  }

  /* Hovering a row selects it, so the menu's own hover tint would mark a second row. */
  .o-palette-results
    .ohne-vertical-menu-item:not(.ohne-vertical-menu-item-active)
    .ohne-vertical-menu-item-button:hover {
    background-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
  }

  /* The active row moves with the pointer, so the menu's bolder active label would make rows jump. */
  .o-palette-results
    .ohne-vertical-menu-item-active
    > .ohne-vertical-menu-item-wrapper
    > .ohne-vertical-menu-item-button {
    font-weight: inherit;
  }

  .o-palette-empty {
    padding: 1.5rem 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
    text-align: center;
  }
`;

/**
 * The search palette, mounted by the dashboard boot into the shell's `global` slot.
 * It renders while `paletteOpen` is set: a search input over the matching records and pages.
 * Typing searches every collection through `POST /search` after a pause, only under the search view.
 * The hits group by collection.
 * The sidebar's menu rows matching the query follow, then the rows the `row` slots list.
 * ArrowUp and ArrowDown move the selection through every row, and Enter picks it.
 * On the first screen, Tab hands the typed words to a layer, such as the assistant, whatever row is selected.
 * A Tab key in the input shows while a layer takes them, and a click on it does the same.
 * Escape steps back to a blank search, and closes the palette from there.
 * Closing keeps the view, so the palette opens again where the person left it.
 * The pointer moves the selection too, so a hover and a keystroke never mark two rows.
 * A key that composes text through an input method is left to it.
 * A row's path navigates once the palette has closed, or the next page's shell would mount it again.
 * A modified click on a row keeps the browser's behaviour and the palette open.
 * The input takes focus as the palette opens, and again after a click that leaves nothing else focused.
 * The `view` slot renderers fill the body under their view, and the `footer` ones a bar under it.
 */
export function palette(): Child {
  return when(
    () => paletteOpen.value,
    () => {
      const t = useT();
      const searching = ref(false);
      const more = ref<ReadonlySet<string>>(new Set());
      const loading = new Set<string>();
      const loadMore = async (collection: string): Promise<void> => {
        if (loading.has(collection)) return;
        loading.add(collection);
        const group = `collection:${collection}`;
        const query = untracked(paletteSearchTerm);
        const offset = untracked(() => paletteHits.value).filter(
          (hit) => hit.collection === collection,
        ).length;
        const next = await fetchHits(query, { collection, offset });
        loading.delete(collection);
        if (!live || untracked(paletteSearchTerm) !== query) return;
        const onMore = untracked(
          () => active.value?.key.startsWith(`${group}\n`) === true && isUndefined(active.value.to),
        );
        paletteHits.value = [...untracked(() => paletteHits.value), ...next];
        if (next.length === PAGE) return;
        const rest = new Set(untracked(() => more.value));
        rest.delete(collection);
        more.value = rest;
        const last = untracked(() =>
          groups.value.find((found) => found.key === group)?.entries.at(-1),
        );
        if (onMore && !isUndefined(last)) paletteActive.value = last.key;
      };
      const groups = computed(() => {
        const meta = dashboardMeta();
        const rows = paletteSlots('row').flatMap((list) => list());
        return paletteGroups(
          paletteQuery.value,
          paletteHits.value,
          meta?.collections ?? [],
          meta?.menu ?? [],
          rows,
          {
            collections: more.value,
            label: t('dashboard.palette.loadMore'),
            load: (collection) => void loadMore(collection),
          },
        );
      });
      const entries = computed(() => groups.value.flatMap((group) => group.entries));
      const active = computed(
        () => entries.value[paletteActiveIndex(entries.value, paletteActive.value)],
      );

      let live = true;
      let closing = false;
      const close = (after?: () => void): void => {
        if (closing) return;
        closing = true;
        const asked = paletteOpens();
        void handle.close().then(() => {
          closePalette();
          after?.();
          if (paletteOpens() !== asked) void nextTick().then(openPalette);
        });
      };
      const pick = (entry: PaletteEntry): void => {
        const { to } = entry;
        if (isUndefined(to)) entry.onSelect?.();
        else close(() => navigate(to));
      };

      const search = debounce(async (query: string) => {
        const hits = await fetchHits(query);
        if (!live || untracked(paletteSearchTerm) !== query) return;
        paletteHits.value = hits;
        more.value = new Set(
          Object.entries(groupBy(hits, (hit) => hit.collection))
            .filter(([, found = []]) => found.length === PAGE)
            .map(([name]) => name),
        );
        searching.value = false;
      }, 200);
      onCleanup(() => {
        live = false;
        search.cancel();
      });

      effect(() => {
        const query = paletteSearchTerm();
        untracked(() => {
          searching.value = query !== '';
          if (query === '') {
            search.cancel();
            paletteHits.value = [];
          } else {
            search(query);
          }
        });
      });

      effect(() => {
        void paletteQuery.value;
        untracked(() => (paletteActive.value = ''));
      });

      const field = searchInput(paletteQuery, {
        autofocus: true,
        actions: () =>
          when(
            () => !isNull(tabOffer()),
            () => {
              const key = h(
                'button',
                {
                  type: 'button',
                  class: 'o-palette-tab ohne-raw',
                  'aria-label': () => tabOffer()?.label ?? '',
                  onClick: () => untracked(tabOffer)?.take(),
                },
                h('kbd', null, 'Tab'),
              );
              onCleanup(attachTooltip(key, () => tabOffer()?.label ?? null));
              return key;
            },
          ),
        placeholder: () =>
          paletteSlots('placeholder')
            .map((word) => word())
            .find(isString) ?? t('dashboard.palette.placeholder'),
        label: () => t('dashboard.palette.label'),
      });
      field.box.classList.add('o-palette-search');

      // Capture phase: the input's own Escape handler blurs it and stops the event from bubbling.
      field.box.addEventListener(
        'keydown',
        (event) => {
          if (isComposing(event)) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (untracked(() => paletteView.value === 'search' && paletteQuery.value === ''))
              close();
            else resetPalette();
            return;
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            const offer = untracked(tabOffer);
            if (isNull(offer)) return;
            event.preventDefault();
            offer.take();
            return;
          }
          if (untracked(() => paletteView.value) !== 'search') return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            movePaletteActive(
              event.key === 'ArrowDown' ? 1 : -1,
              untracked(() => entries.value),
            );
          } else if (event.key === 'Enter') {
            const entry = untracked(() => active.value);
            if (isUndefined(entry)) return;
            event.preventDefault();
            pick(entry);
          }
        },
        { capture: true },
      );

      let pointerX = NaN;
      let pointerY = NaN;
      const results = h(
        'div',
        {
          class: 'o-palette-results',
          // The rows never take focus, so the input keeps it through a click.
          onMousedown: (event: MouseEvent) => event.preventDefault(),
          onMousemove: (event: MouseEvent) => {
            // A scroll under a resting pointer replays the event; only a real move selects the row.
            if (event.clientX === pointerX && event.clientY === pointerY) return;
            pointerX = event.clientX;
            pointerY = event.clientY;
            const entry = untracked(() => entries.value)[rowIndex(results, event.target)];
            if (!isUndefined(entry)) paletteActive.value = entry.key;
          },
          onClick: (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const to = target?.closest('a')?.getAttribute('href');
            if (isNullish(to) || event.button !== 0 || hasModifierKey(event)) return;
            event.preventDefault();
            close(() => navigate(to));
          },
        },
        each(
          () => groups.value,
          (group) => group.key,
          (group) => {
            const menu = verticalMenu({
              title: untracked(group).label === '' ? undefined : () => group().label,
              items: () =>
                group().entries.map((entry) => ({
                  to: entry.to,
                  action: entry.onSelect,
                  label: entry.label,
                  icon: entry.more === true ? moreIcon() : entry.icon,
                  hint: isUndefined(entry.time)
                    ? undefined
                    : { text: formatRelative(entry.time), tooltip: formatDateTime(entry.time) },
                  active: entry.key === active.value?.key,
                })),
            });
            menu.dataset.group = untracked(group).key;
            return menu;
          },
        ),
      );

      effect(() => {
        void active.value;
        void groups.value;
        void nextTick().then(() =>
          results
            .querySelector('.ohne-vertical-menu-item-active')
            ?.scrollIntoView({ block: 'nearest' }),
        );
      });

      const handle: Popup = popup(
        [
          when(
            () => paletteView.value === 'search',
            () => [
              results,
              when(
                () =>
                  paletteQuery.value.trim() !== '' &&
                  !searching.value &&
                  entries.value.length === 0,
                () =>
                  h(
                    'div',
                    { 'aria-live': 'polite', role: 'status', class: 'o-palette-empty' },
                    () => t('dashboard.noResultsFound'),
                  ),
              ),
            ],
          ),
          paletteSlots('view').map((render) => render()),
        ],
        {
          width: '36rem',
          size: -1,
          fullHeight: 'auto',
          additionalClasses: ['o-palette'],
          header: field.box,
          ...(isEmpty(paletteSlots('footer'))
            ? {}
            : { footer: paletteSlots('footer').map((render) => render()) }),
          onClose: () => close(),
        },
      );

      effect(() => {
        if (paletteView.value === 'search')
          void nextTick().then(() => handle.content.scrollTo(0, 0));
      });

      // The popup autofocuses a timeout later, too late for the first keystroke after the hotkey.
      field.input.focus();
      const refocus = (): void => {
        const active = document.activeElement;
        // A control or dropdown the click focused keeps it; the body, popup or scroll pane hand it back.
        if (
          closing ||
          (active instanceof HTMLElement &&
            (active.tabIndex >= 0 || !isNull(active.closest('.ohne-dropdown'))))
        ) {
          return;
        }
        // A drag that selected text keeps it; focusing the input would drop the selection.
        if (document.getSelection()?.isCollapsed === false) return;
        field.input.focus();
      };
      // A timeout: a click's own handlers run first, and a control they unmount drops focus to the body.
      handle.root.addEventListener('click', () => setTimeout(refocus));
      return null;
    },
  );
}

/**
 * What Tab does with the typed words on the first screen: the first layer's offer, or `null` for none.
 */
function tabOffer(): PaletteTab | null {
  const query = paletteQuery.value.trim();
  if (paletteView.value !== 'search' || query === '') return null;
  for (const offer of paletteSlots('tab')) {
    const taken = offer(query);
    if (!isNull(taken)) return taken;
  }
  return null;
}

/**
 * The chevron that trails a Load more label, marking its row for the quieter style.
 */
function moreIcon(): Element {
  const chevron = icon('chevron-down');
  chevron.classList.add('o-palette-more');
  return chevron;
}

/**
 * The position of the row under `target` among the results' rows, or `-1` off any row.
 * The rows sit in document order, the order the entries are numbered in.
 */
function rowIndex(results: HTMLElement, target: EventTarget | null): number {
  const row = target instanceof Element ? target.closest('.ohne-vertical-menu-item') : null;
  if (isNull(row)) return -1;
  return [...results.querySelectorAll('.ohne-vertical-menu-item')].indexOf(row);
}

/**
 * The records `POST /search` finds for `query`, a page per collection.
 * Each unlabeled one is named by its short `UUID`.
 * With `collection`, only that one is searched, from `offset` on.
 * A failed request finds nothing.
 */
async function fetchHits(
  query: string,
  window: { collection?: string; offset?: number } = {},
): Promise<PaletteHit[]> {
  try {
    const response = await api('POST /search', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, limit: PAGE, ...window }),
    });
    if (!response.ok) return [];
    const { results } = (await response.json()) as { results: PaletteHit[] };
    return results.map((hit) =>
      hit.label === '' ? { ...hit, label: fallbackLabel(hit.UUID) } : hit,
    );
  } catch {
    return [];
  }
}
