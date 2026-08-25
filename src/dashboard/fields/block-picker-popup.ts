import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from '../ui/button.ts';
import { icon } from '../ui/icon.ts';
import { popup } from '../ui/popup-overlay.ts';
import { textInput } from '../ui/text-input.ts';
import { blocksOf } from './_blocks.ts';
import { blockNamed } from './_items.ts';

interface PickerBlock {
  name: string;
  label: string;
  search: string;
}

css`
  .ohne-block-picker-title {
    font-weight: 500;
  }

  .ohne-block-picker-search {
    position: relative;
  }

  .ohne-block-picker-search .ohne-input-control {
    padding-right: calc(1.5rem + 0.5em);
  }

  .ohne-block-picker-search > .ohne-button {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-block-picker-group {
    margin-top: 1rem;
  }

  .ohne-block-picker-blocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .ohne-block-picker-block {
    display: flex;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 0.75rem;
    background-color: transparent;
    border-width: 1px;
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-secondary-foreground));
    text-align: left;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, color;
  }

  .ohne-block-picker-block[disabled] {
    pointer-events: none;
  }

  .ohne-block-picker-block:hover,
  .ohne-block-picker-block-highlighted {
    background-color: hsl(var(--ohne-accent));
    border-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-block-picker-block:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-block-picker-block-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .ohne-block-picker-block-title {
    font-weight: 500;
    line-height: 1.375rem;
  }

  .ohne-block-picker-block-no-results {
    margin-top: 0.75rem;
  }

  @media (max-width: 520px) {
    .ohne-block-picker-blocks {
      grid-template-columns: 1fr;
    }
  }
`;

/**
 * Opens the block picker popup, ported from Pruvious v4's `BlockPickerPopup`.
 *
 * A search-first popup over the block types `allowed` names, or every described type when omitted.
 * Typing anywhere before the search input takes focus funnels into the search.
 * Arrows walk the grid - up and down move within a column, left and right step through the list -
 * Enter picks the highlighted block, and Tab moves focus onto the grid itself.
 * Mouse highlighting pauses after keyboard moves until the pointer really travels again.
 *
 * Resolves with the picked block name the moment it is chosen, before the close animation.
 * The caller inserts while the popup fades; Escape and the overlay click resolve `null`.
 * A `null` close restores focus to the previously focused element.
 * A pick leaves focus to the caller, which moves it into the new block's form.
 */
export function openBlockPicker(allowed?: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const scope = effectScope();
    scope.run(() => {
      const t = useT();
      const prevFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const searchValue = ref('');
      const mousePaused = ref(true);
      const highlightedBlock = ref<string | null>(null);
      let picked: string | null = null;
      let settled = false;
      let initialFocus = false;

      // ohne meta describes neither block groups nor tags, so the source's grouped sections and
      // tag filter row collapse into one unlabeled group; its label never rendered for a single
      // group anyway. The description is absent too, so the search text is label plus name, with
      // the source's pad keeping their relative relevance.
      const blocks = computed<readonly PickerBlock[]>(() => {
        const registry = blocksOf();
        const names = allowed ?? registry.map((block) => block.name);
        return names.map((name) => {
          const label = blockNamed(registry, name)?.label ?? name;
          return { name, label, search: [label.padEnd(63), name].join(' ') };
        });
      });

      const filteredBlocks = computed<readonly PickerBlock[]>(() =>
        searchBlocksByKeywords(blocks.value, searchValue.value),
      );

      const getFirstFilteredBlock = (): string | null => filteredBlocks.value[0]?.name ?? null;

      const getLastFilteredBlock = (): string | null =>
        filteredBlocks.value[filteredBlocks.value.length - 1]?.name ?? null;

      const focusFirstFilteredBlock = (): void => {
        if (!isNull(getFirstFilteredBlock())) {
          handle.root
            .querySelector<HTMLButtonElement>('.ohne-block-picker-block:not([disabled])')
            ?.focus();
        }
      };

      // The grid is two columns above the 520px breakpoint, so a vertical step is two items.
      const highlightPrevious = (up = false): void => {
        const sameColumn = up && window.innerWidth > 520;
        if (isNull(highlightedBlock.value)) {
          highlightedBlock.value = getLastFilteredBlock();
          return;
        }
        const list = filteredBlocks.value;
        const index = list.findIndex((block) => block.name === highlightedBlock.value);
        if (index === -1) return;
        const previous = list[index - (sameColumn ? 2 : 1)];
        if (!isUndefined(previous)) highlightedBlock.value = previous.name;
      };

      const highlightNext = (down = false): void => {
        const sameColumn = down && window.innerWidth > 520;
        if (isNull(highlightedBlock.value)) {
          highlightedBlock.value = getFirstFilteredBlock();
          return;
        }
        const list = filteredBlocks.value;
        const index = list.findIndex((block) => block.name === highlightedBlock.value);
        if (index === -1) return;
        const next = list[index + (sameColumn ? 2 : 1)];
        if (!isUndefined(next)) highlightedBlock.value = next.name;
      };

      const settle = (value: string | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
        void handle.close().then(() => {
          scope.dispose();
          if (isNull(value)) setTimeout(() => prevFocus?.focus());
        });
      };

      const choose = (name: string): void => {
        picked = name;
        settle(name);
      };

      const focusSearchInput = (): void => {
        initialFocus = true;
        handle.root.querySelector('input')?.focus();
      };

      // Until the search input takes focus after the overlay animates, printable keys funnel
      // into the search value, exactly as the source's self-removing capture listener did.
      const onCaptureKeydown = (event: KeyboardEvent): void => {
        if (initialFocus) {
          window.removeEventListener('keydown', onCaptureKeydown, { capture: true });
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          searchValue.value += event.key;
          event.preventDefault();
        }
      };
      window.addEventListener('keydown', onCaptureKeydown, { capture: true });

      const onMouseMove = (): void => {
        mousePaused.value = false;
      };
      window.addEventListener('mousemove', onMouseMove);

      onCleanup(() => {
        window.removeEventListener('keydown', onCaptureKeydown, { capture: true });
        window.removeEventListener('mousemove', onMouseMove);
      });

      const search = textInput(searchValue, {
        name: 'ohne-block-picker-search',
        placeholder: () => t('dashboard.searchPlaceholder'),
        onFocus: () => {
          mousePaused.value = true;
          highlightedBlock.value = getFirstFilteredBlock();
        },
        onBlur: () => {
          mousePaused.value = false;
          highlightedBlock.value = null;
        },
      });
      search.addEventListener('input', () => {
        mousePaused.value = true;
        void nextTick().then(() => {
          highlightedBlock.value = getFirstFilteredBlock();
        });
      });
      search.addEventListener('keydown', (event) => {
        const clean = !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
        if (event.key === 'ArrowDown' && clean) highlightNext(true);
        else if (event.key === 'ArrowUp' && clean) highlightPrevious(true);
        else if (event.key === 'ArrowLeft' && clean) highlightPrevious();
        else if (event.key === 'ArrowRight' && clean) highlightNext();
        else if (event.key === 'Enter' && !isNull(highlightedBlock.value)) {
          choose(highlightedBlock.value);
        } else if (event.key === 'Tab' && !event.shiftKey) {
          mousePaused.value = false;
          void nextTick().then(focusFirstFilteredBlock);
        }
      });

      const clearButton = (): HTMLElement => {
        const cross = icon('x');
        cross.setAttribute('width', '1.125em');
        cross.setAttribute('height', '1.125em');
        const clear = button(cross, {
          size: -3,
          variant: 'ghost',
          onClick: (event) => {
            event.stopPropagation();
            searchValue.value = '';
            focusSearchInput();
          },
        });
        clear.setAttribute('tabindex', '-1');
        effect(() => {
          clear.title = t('dashboard.clear');
        });
        return clear;
      };

      const blockButton = (block: () => PickerBlock): HTMLElement =>
        h(
          'button',
          {
            class: () =>
              'ohne-block-picker-block ohne-raw' +
              (highlightedBlock.value === block().name
                ? ' ohne-block-picker-block-highlighted'
                : ''),
            disabled: () => mousePaused.value,
            onClick: () => choose(block().name),
          },
          // ohne meta carries no per-block icon or description, so the source's leading icon
          // column and description line are skipped.
          h(
            'span',
            { class: 'ohne-block-picker-block-meta' },
            h('span', { class: 'ohne-block-picker-block-title' }, () => block().label),
          ),
        );

      const body =
        isUndefined(allowed) || allowed.length > 0
          ? h(
              'div',
              null,
              h(
                'div',
                { class: 'ohne-block-picker-search' },
                search,
                when(() => searchValue.value !== '', clearButton),
              ),
              when(
                () => filteredBlocks.value.length > 0,
                () =>
                  h(
                    'div',
                    { class: 'ohne-block-picker-group' },
                    h(
                      'div',
                      { class: 'ohne-block-picker-blocks' },
                      each(
                        () => filteredBlocks.value,
                        (block) => block.name,
                        (block) => blockButton(block),
                      ),
                    ),
                  ),
                () =>
                  h('p', { class: 'ohne-block-picker-block-no-results ohne-muted' }, () =>
                    t('dashboard.noBlocksMatchSearch'),
                  ),
              ),
            )
          : h('p', { class: 'ohne-muted' }, () => t('dashboard.noBlocksAllowed'));

      const closeButton = button(icon('x'), {
        size: -2,
        variant: 'ghost',
        class: 'ohne-ml-auto',
        onClick: () => settle(picked),
      });
      effect(() => {
        closeButton.title = t('dashboard.close');
      });

      const handle = popup(body, {
        size: -1,
        width: '36rem',
        fullHeight: 'auto',
        overlayTransitionDuration: 150,
        header: h(
          'span',
          { class: 'ohne-block-picker-title ohne-row' },
          h('span', { class: 'ohne-truncate' }, () => t('dashboard.selectBlock')),
          closeButton,
        ),
        onClose: () => settle(picked),
        onOverlayAnimated: focusSearchInput,
      });
    });
  });
}

/* The source's `searchByKeywords` from `@pruvious/utils`, specialized to the picker: every
   keyword must match the lowercased search text, scored by `keyword.length / (index + 1)`,
   sorted by relevance. */
function searchBlocksByKeywords(
  blocks: readonly PickerBlock[],
  query: string,
): readonly PickerBlock[] {
  const keywords = query
    .toLowerCase()
    .split(' ')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const haystack = block.search.toLowerCase();
      let score = 0.1;
      if (keywords.length) {
        score = 0;
        for (const keyword of keywords) {
          const index = haystack.indexOf(keyword);
          if (index === -1) {
            score = 0;
            break;
          }
          score += keyword.length / (index + 1);
        }
      }
      return { block, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ block }) => block);
}
