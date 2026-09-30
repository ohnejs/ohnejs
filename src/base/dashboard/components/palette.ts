import {
  api,
  type Child,
  css,
  dashboardMeta,
  each,
  fallbackLabel,
  h,
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
  effect,
  isComposing,
  isEmpty,
  isNull,
  isNullish,
  isUndefined,
  nextTick,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import { paletteSlots } from './palette-slots.ts';
import {
  closePalette,
  movePaletteActive,
  type PaletteEntry,
  type PaletteHit,
  paletteActive,
  paletteGroups,
  paletteHits,
  paletteOpen,
  paletteQuery,
  paletteSearchTerm,
  paletteView,
} from './palette-state.ts';
import { searchInput } from './search-input.ts';

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
    padding: 0.375rem 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .o-palette-results {
    display: flex;
    flex-direction: column;
    gap: 1em;
  }

  /* Hovering a row selects it, so the menu's own hover tint would mark a second row. */
  .o-palette-results
    .ohne-vertical-menu-item:not(.ohne-vertical-menu-item-active)
    .ohne-vertical-menu-item-button:hover {
    background-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
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
 * ArrowUp and ArrowDown move the selection through every row, Enter picks it, and Escape closes the palette.
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
      const groups = computed(() => {
        const meta = dashboardMeta();
        const rows = paletteSlots('row').flatMap((list) => list());
        return paletteGroups(
          paletteQuery.value,
          paletteHits.value,
          meta?.collections ?? [],
          meta?.menu ?? [],
          rows,
        );
      });
      const entries = computed(() => groups.value.flatMap((group) => group.entries));

      let live = true;
      let closing = false;
      const close = (after?: () => void): void => {
        if (closing) return;
        closing = true;
        void handle.close().then(() => {
          closePalette();
          after?.();
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

      // A settling turn relists the rows too; only a new query or new hits restart the selection.
      effect(() => {
        void paletteQuery.value;
        void paletteHits.value;
        untracked(() => (paletteActive.value = 0));
      });

      const field = searchInput(paletteQuery, {
        autofocus: true,
        placeholder: () => t('dashboard.palette.placeholder'),
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
            close();
            return;
          }
          if (untracked(() => paletteView.value) !== 'search') return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            movePaletteActive(
              event.key === 'ArrowDown' ? 1 : -1,
              untracked(() => entries.value).length,
            );
          } else if (event.key === 'Enter') {
            const entry = untracked(() => entries.value)[untracked(() => paletteActive.value)];
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
            const at = rowIndex(results, event.target);
            if (at !== -1) paletteActive.value = at;
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
          (group) =>
            verticalMenu({
              title: untracked(group).label || undefined,
              items: () =>
                group().entries.map((entry) => ({
                  to: entry.to,
                  action: entry.onSelect,
                  label: entry.label,
                  icon: entry.icon,
                  active: entry.index === paletteActive.value,
                })),
            }),
        ),
      );

      effect(() => {
        void paletteActive.value;
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

      // The popup autofocuses a timeout later, too late for the first keystroke after the hotkey.
      field.input.focus();
      const refocus = (): void => {
        const active = document.activeElement;
        // A control the click focused keeps it; the body, the popup or its scroll pane hand it back.
        if (closing || (active instanceof HTMLElement && active.tabIndex >= 0)) return;
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
 * The position of the row under `target` among the results' rows, or `-1` off any row.
 * The rows sit in document order, the order the entries are numbered in.
 */
function rowIndex(results: HTMLElement, target: EventTarget | null): number {
  const row = target instanceof Element ? target.closest('.ohne-vertical-menu-item') : null;
  if (isNull(row)) return -1;
  return [...results.querySelectorAll('.ohne-vertical-menu-item')].indexOf(row);
}

/**
 * The records `POST /search` finds for `query`, each unlabeled one named by its short `UUID`.
 * A failed request finds nothing.
 */
async function fetchHits(query: string): Promise<PaletteHit[]> {
  try {
    const response = await api('POST /search', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query }),
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
