import type { Ref } from '../../utils/reactive/ref.ts';

import { last } from '../../utils/array/last.ts';
import { next } from '../../utils/array/next.ts';
import { prev } from '../../utils/array/prev.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { type Primitive } from './button-group.ts';
import { nearestContainer } from './container.ts';
import { icon } from './icon.ts';
import { listenClickOutside, lockScroll } from './overlay.ts';
import { type ScrollableHandle, scrollable } from './scrollable.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * One choice a `dynamicSelect` resolver returns.
 */
export interface DynamicSelectChoice {
  /**
   * An optional label to display for the choice in the select field.
   * If not provided, the `value` is displayed instead.
   */
  label?: string;

  /**
   * An optional detail to display for the choice.
   * It is displayed in a grayed out style below the label.
   */
  detail?: string;

  /**
   * An optional badge label shown as a small chip next to the choice label.
   */
  badge?: string;

  /**
   * The value of the choice in the select field.
   */
  value: Primitive;

  /**
   * Indicates whether the choice is disabled.
   *
   * @default
   * false
   */
  disabled?: boolean;
}

/**
 * One page of resolved `dynamicSelect` choices.
 */
export interface DynamicSelectPaginatedChoices {
  /**
   * The choices of this page.
   */
  choices: DynamicSelectChoice[];

  /**
   * The current page number.
   */
  currentPage: number;

  /**
   * The number of the last available page.
   */
  lastPage: number;

  /**
   * Number of choices displayed per page.
   */
  perPage: number;

  /**
   * Total count of all choices.
   */
  total: number;
}

/**
 * Options for `dynamicSelect`.
 */
export interface DynamicSelectOptions {
  /**
   * Resolves the choices for the select field.
   * It receives the current `page` number and the search `keyword` as arguments.
   */
  choicesResolver: (page: number, keyword: string) => Promise<DynamicSelectPaginatedChoices>;

  /**
   * Resolves the selected choice based on its value.
   */
  selectedChoiceResolver: (value: Primitive) => Promise<DynamicSelectChoice | null>;

  /**
   * Adjusts the size of the component, from -2 (very small) to 2 (very large).
   * Omitted, the value is inherited as `--ohne-size` from the parent element.
   */
  size?: number;

  /**
   * Placeholder text shown when no label or value is displayed in the select field.
   */
  placeholder?: string;

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the select reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input element.
   * A `fieldLabel` for this id focuses the field through the trigger bus.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input element that holds the selected value.
   * The search input takes `<name>--keyword`.
   */
  name?: string;

  /**
   * The placeholder for the search input field.
   *
   * @default
   * 'Search...'
   */
  searchLabel?: string;

  /**
   * Text label for the no results found message in the choices dropdown.
   *
   * @default
   * 'No results found'
   */
  noResultsLabel?: string;

  /**
   * An optional keyword used to pre-fill the search input each time the dropdown opens.
   * Useful when the current value is free-form text the user may want to copy or edit.
   *
   * @default
   * ''
   */
  initialKeyword?: string;

  /**
   * A scrollable ancestor: scroll-locked while open, and the choices overlay's height reference.
   * Omitted, the control's nearest `.ohne-container` ancestor stands in, then the window.
   */
  scrollContainer?: HTMLElement;

  /**
   * Called with the picked value right before the model updates.
   */
  onCommit?: (value: Primitive) => void;
}

css`
  .ohne-dynamic-select-wrapper {
    width: 100%;
  }

  .ohne-dynamic-select {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    position: relative;
    display: flex;
    align-items: center;
    gap: calc(0.5em + 0.125rem);
    width: 100%;
    height: calc(2em + 0.25rem);
    padding: 0 0.5em;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    cursor: pointer;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.25;
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-dynamic-select-expanded {
    cursor: default;
  }

  .ohne-dynamic-select-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-dynamic-select:not(.ohne-dynamic-select-disabled):focus,
  .ohne-dynamic-select:not(.ohne-dynamic-select-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-dynamic-select-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    cursor: default;
    background-color: hsl(var(--ohne-muted));
    box-shadow: none;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-select-selected-choice,
  .ohne-dynamic-select-placeholder {
    margin: auto 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-dynamic-select-placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-select-icon {
    flex-shrink: 0;
    margin-left: auto;
  }

  .ohne-dynamic-select-choices {
    position: absolute;
    z-index: 11;
    top: -1px;
    right: -1px;
    left: -1px;
    height: calc(100% + 2px);
    overflow: hidden;
    background-color: hsl(var(--ohne-background));
    border: 1px solid transparent;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
    visibility: hidden;
  }

  .ohne-dynamic-select-expanded .ohne-dynamic-select-choices {
    height: calc(100% + 2px);
    visibility: visible;
    transition: var(--ohne-transition);
    transition-property: height, visibility, transform;
  }

  .ohne-dynamic-select-choice {
    display: flex;
    align-items: center;
    width: 100%;
    height: calc(2em + 0.25rem - 2px);
    padding: 0 calc(0.5em - 1px);
    border: 1px solid hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    cursor: pointer;
    color: hsl(var(--ohne-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-dynamic-select-choice-detailed {
    height: calc(3em + 0.25rem - 2px);
  }

  .ohne-dynamic-select-choice-selected {
    display: flex;
    justify-content: space-between;
    gap: 1em;
    padding-right: calc(0.5em + 1px);
  }

  .ohne-dynamic-select-choice-highlighted {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-dynamic-select-choice-disabled {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-select-choice-content,
  .ohne-dynamic-select-choice-label,
  .ohne-dynamic-select-choice-detail {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-dynamic-select-choice-content {
    display: flex;
    flex-direction: column;
    text-align: left;
  }

  .ohne-dynamic-select-choice-label-row {
    display: flex;
    align-items: center;
    gap: 0.375em;
    overflow: hidden;
  }

  .ohne-dynamic-select-choice-detail {
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875em;
  }

  .ohne-dynamic-select-badge {
    flex-shrink: 0;
    padding: 0 0.375em;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
    font-size: 0.75em;
    line-height: 1.5;
  }

  .ohne-dynamic-select-choice-highlighted .ohne-dynamic-select-badge {
    background-color: hsl(var(--ohne-foreground));
    color: hsl(var(--ohne-accent));
  }

  .ohne-dynamic-select-selected-choice + .ohne-dynamic-select-badge {
    margin-left: -0.125em;
  }

  .ohne-dynamic-select-keyword {
    position: sticky;
    top: 0;
    width: 100%;
    height: calc(2em + 0.25rem);
    margin: -1px;
    background-color: hsl(var(--ohne-background));
    transition: var(--ohne-transition);
    transition-property: top;
  }

  .ohne-dynamic-select-keyword-offset {
    top: 1em;
  }

  .ohne-dynamic-select-keyword-input {
    width: 100%;
    height: 100%;
    padding: 0 calc(0.5em + 0.0625rem);
    background-color: transparent;
    border: none;
    outline: none;
    font-size: 1em;
    line-height: 1.25;
    color: hsl(var(--ohne-foreground));
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-dynamic-select-keyword-input::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-select-no-results {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: calc(2em + 0.25rem - 2px);
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-select-no-results span {
    font-size: calc(1em - 0.0625rem);
  }
`;

function fieldIcon(name: 'selector' | 'check'): SVGSVGElement {
  const svg = icon(name);
  svg.classList.add('ohne-dynamic-select-icon');
  svg.setAttribute('width', '1.125em');
  svg.setAttribute('height', '1.125em');
  return svg;
}

function labelOrDash(choice: DynamicSelectChoice): string {
  return String((choice.label ?? choice.value) || '-');
}

/**
 * The async single-select combobox, ported 1-to-1 from Pruvious v4's `PUIDynamicSelect`.
 *
 * The same in-place overlay as `select`, plus a sticky search input and a 250ms-debounced remote search.
 * Results paginate on infinite scroll; every open refetches page 1 through `choicesResolver`.
 * The overlay caps at the search row plus 11 choice rows and grows or shrinks with the results.
 * The selected choice resolves asynchronously through `selectedChoiceResolver`.
 * The field renders its placeholder until the initial resolve lands, replacing the source's async setup.
 * Row height follows the first choice: a `detail` there switches the whole list to tall rows.
 *
 * @example
 * ```ts
 * const author = ref<Primitive>(null)
 * dynamicSelect(author, {
 *   choicesResolver: (page, keyword) => api.searchUsers(page, keyword),
 *   selectedChoiceResolver: (value) => api.resolveUser(value),
 * })
 * ```
 */
export function dynamicSelect(model: Ref<Primitive>, options: DynamicSelectOptions): HTMLElement {
  const error = options.error ?? ((): boolean => false);
  const disabled = options.disabled ?? ((): boolean => false);
  const isExpanded = ref(false);
  const choices = ref<DynamicSelectChoice[]>([]);
  const hasDetails = computed(() => !isUndefined(choices.value[0]?.detail));
  const selectedChoice = ref<DynamicSelectChoice | null>(null);
  const highlightedChoice = ref<DynamicSelectChoice | undefined>(undefined);
  const choicesHeight = ref<number | undefined>(undefined);
  const choicesTopOffset = ref(0);
  const keyword = ref('');
  const mousePaused = ref(false);
  const topButtonVisible = ref(false);

  let scroll!: ScrollableHandle;
  let currentPage = 1;
  let lastPage = 1;
  let isLoadingMore = false;
  let fetchCounter = 0;
  let transitionDuration = 300;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let unpauseMouseTimeout: ReturnType<typeof setTimeout> | undefined;
  let stopOutsideClick: (() => void) | undefined;
  let stopResize: (() => void) | undefined;
  let unlockWindow: (() => void) | undefined;
  let unlockContainer: (() => void) | undefined;

  const enabledChoices = (): DynamicSelectChoice[] =>
    choices.value.filter((choice) => !choice.disabled);

  const calcItemSizes = (): {
    baseFontSize: number;
    em: number;
    itemHeight: number;
    detailedItemHeight: number;
  } => {
    const baseFontSize = +getComputedStyle(document.documentElement)
      .getPropertyValue('font-size')
      .slice(0, -2);
    const sizeVar = getComputedStyle(combobox).getPropertyValue('--ohne-size');
    const size = sizeVar ? +sizeVar : 0;
    const em = baseFontSize + size * 0.125 * baseFontSize;
    return {
      baseFontSize,
      em,
      itemHeight: 2 * em + 0.25 * baseFontSize - 2,
      detailedItemHeight: 3 * em + 0.25 * baseFontSize - 2,
    };
  };

  const open = async (event?: Event): Promise<void> => {
    if (isExpanded.value) return;
    event?.preventDefault();

    // Pre-fill the search input so a free-form value can be copied or edited instead of retyped.
    keyword.value = options.initialKeyword ?? '';

    const fc = ++fetchCounter;
    const page = await options.choicesResolver(1, keyword.value);
    if (fc !== fetchCounter) return;

    choices.value = page.choices;
    currentPage = page.currentPage;
    lastPage = page.lastPage;

    isExpanded.value = true;
    stopOutsideClick = listenClickOutside(combobox, () => close());
    const onResize = (): void => close();
    window.addEventListener('resize', onResize);
    stopResize = () => window.removeEventListener('resize', onResize);
    const pane = options.scrollContainer ?? nearestContainer(combobox);
    unlockWindow = lockScroll(document.documentElement);
    unlockContainer = pane ? lockScroll(pane) : undefined;

    updateSizes();
    mousePaused.value = true;

    // Focus the keyword input once the expand animation ends, selecting any pre-filled text.
    setTimeout(() => {
      keywordInput.focus();
      keywordInput.select();
    }, transitionDuration);
  };

  const close = (event?: Event): void => {
    if (!isExpanded.value) return;
    isExpanded.value = false;
    highlightedChoice.value = undefined;
    stopOutsideClick?.();
    stopOutsideClick = undefined;
    stopResize?.();
    stopResize = undefined;
    unlockWindow?.();
    unlockWindow = undefined;
    unlockContainer?.();
    unlockContainer = undefined;
    choicesHeight.value = undefined;
    choicesTopOffset.value = 0;
    choices.value = [];
    currentPage = 1;
    lastPage = 1;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    keyword.value = '';
    event?.preventDefault();
  };

  const toggle = (event?: Event): void => {
    if (isExpanded.value) close(event);
    else void open(event);
  };

  const focusPrevious = (): void => {
    if (isExpanded.value) {
      const pool = enabledChoices();
      highlightedChoice.value = highlightedChoice.value
        ? prev(highlightedChoice.value, pool, { prop: 'value' })
        : last(pool);
      mousePaused.value = true;
      scrollToHighlighted();
    }
  };

  const focusNext = (): void => {
    if (isExpanded.value) {
      const pool = enabledChoices();
      highlightedChoice.value = highlightedChoice.value
        ? next(highlightedChoice.value, pool, { prop: 'value' })
        : pool[0];
      mousePaused.value = true;
      scrollToHighlighted();
    }
  };

  const focusFirst = (event?: Event): void => {
    if (isExpanded.value) {
      highlightedChoice.value = enabledChoices()[0];
      mousePaused.value = true;
      scrollToHighlighted();
      event?.preventDefault();
    }
  };

  const selectHighlighted = (event?: Event): void => {
    const highlighted = highlightedChoice.value;
    if (isExpanded.value && highlighted && !highlighted.disabled) {
      emitChoice(highlighted);
      close(event);
    }
  };

  const selectHighlightedOrClose = async (event?: Event): Promise<void> => {
    if (isExpanded.value) {
      await flushKeywordSearch();
      if (highlightedChoice.value) selectHighlighted(event);
      else close(event);
    }
  };

  const selectHighlightedOrToggle = (event?: Event): void => {
    if (isExpanded.value && highlightedChoice.value) selectHighlighted(event);
    else toggle(event);
  };

  const emitChoice = (choice: DynamicSelectChoice): void => {
    selectedChoice.value = choice;
    options.onCommit?.(choice.value);
    model.value = choice.value;
  };

  const scrollToHighlighted = (): void => {
    const { em, itemHeight, detailedItemHeight } = calcItemSizes();
    const rowHeight = hasDetails.value ? detailedItemHeight : itemHeight;
    let offset = 0;
    let found = false;
    for (const choice of choices.value) {
      if (choice.value === highlightedChoice.value?.value) {
        found = true;
        break;
      }
      offset++;
    }
    let top = found ? rowHeight * offset : 0;
    // Reduce the top offset by the height of the top scroll button.
    if (top > 0 && (!scroll.arrivedTop.value || !scroll.arrivedBottom.value)) top -= em;
    scrollableEl.scrollTo({ top, behavior: 'instant' });
  };

  const scrollChoices = (direction: 'up' | 'down'): void => {
    if (isExpanded.value && !mousePaused.value) {
      const { itemHeight, detailedItemHeight } = calcItemSizes();
      const rowHeight = hasDetails.value ? detailedItemHeight : itemHeight;
      scrollableEl.scrollTo({
        top: scrollableEl.scrollTop + (direction === 'up' ? -rowHeight : rowHeight),
        behavior: 'instant',
      });
    }
  };

  const unpauseMouseDelayed = (): void => {
    if (mousePaused.value && isUndefined(unpauseMouseTimeout)) {
      unpauseMouseTimeout = setTimeout(() => {
        mousePaused.value = false;
        unpauseMouseTimeout = undefined;
      }, 150);
    }
  };

  const searchChoices = async (): Promise<void> => {
    highlightedChoice.value = undefined;
    const fc = ++fetchCounter;
    const page = await options.choicesResolver(1, keyword.value);
    if (isExpanded.value && fc === fetchCounter) {
      if (!deepEqual(page.choices, choices.value)) {
        choices.value = page.choices;
        currentPage = page.currentPage;
        lastPage = page.lastPage;
        updateSizes();
      }
      focusFirst();
    }
  };

  const onKeywordInput = (): void => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      if (isExpanded.value) void searchChoices();
    }, 250);
  };

  const flushKeywordSearch = async (): Promise<void> => {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = undefined;
      if (isExpanded.value) await searchChoices();
    }
  };

  const updateSizes = (): void => {
    const { itemHeight, detailedItemHeight } = calcItemSizes();
    const rootRect = combobox.getBoundingClientRect();
    const container = options.scrollContainer ?? nearestContainer(combobox);
    const parentHeight = container ? container.offsetHeight : window.innerHeight;
    const rootTop = container ? rootRect.top - container.getBoundingClientRect().top : rootRect.top;
    const rootBottom = parentHeight - rootTop;

    let height = itemHeight + 2;
    let overflows = false;

    if (choices.value.length) {
      for (let i = 1; i <= Math.min(choices.value.length, 11); i++) {
        height += hasDetails.value ? detailedItemHeight : itemHeight;
        if (height + 4 > parentHeight) {
          height = parentHeight - 6;
          overflows = true;
          break;
        }
      }
    } else {
      height += itemHeight;
      if (height + 4 > parentHeight) {
        height = parentHeight - 6;
        overflows = true;
      }
    }

    let panelHeight = height;
    let topOffset = 0;
    if (rootBottom <= panelHeight) {
      topOffset = rootBottom - panelHeight - 2 + 4;
      if (overflows) panelHeight -= 10;
      else topOffset -= 10;
    }
    choicesHeight.value = panelHeight;
    choicesTopOffset.value = topOffset;
  };

  const choiceRow = (choice: DynamicSelectChoice): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: () => {
          let classes = 'ohne-dynamic-select-choice ohne-raw';
          if (choice.value === model.value) classes += ' ohne-dynamic-select-choice-selected';
          if (choice.value === highlightedChoice.value?.value) {
            classes += ' ohne-dynamic-select-choice-highlighted';
          }
          if (choice.disabled) classes += ' ohne-dynamic-select-choice-disabled';
          if (choice.detail !== undefined) classes += ' ohne-dynamic-select-choice-detailed';
          return classes;
        },
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          if (!choice.disabled) {
            emitChoice(choice);
            close();
          }
        },
        onMouseenter: () => {
          if (!mousePaused.value && !choice.disabled) highlightedChoice.value = choice;
        },
        onMouseleave: () => {
          if (!mousePaused.value && !choice.disabled) highlightedChoice.value = undefined;
        },
        onMousemove: () => {
          if (choice.value !== highlightedChoice.value?.value && !choice.disabled) {
            highlightedChoice.value = choice;
          }
          if (mousePaused.value) mousePaused.value = false;
        },
      },
      h(
        'span',
        {
          title: choice.label ?? String(choice.value),
          class: 'ohne-dynamic-select-choice-content',
        },
        h(
          'span',
          { class: 'ohne-dynamic-select-choice-label-row' },
          h('span', { class: 'ohne-dynamic-select-choice-label' }, labelOrDash(choice)),
          choice.badge ? h('span', { class: 'ohne-dynamic-select-badge' }, choice.badge) : null,
        ),
        choice.detail !== undefined
          ? h('span', { class: 'ohne-dynamic-select-choice-detail' }, choice.detail || '-')
          : null,
      ),
      when(
        () => choice.value === model.value,
        () => fieldIcon('check'),
      ),
    );

  const keywordInput = h('input', {
    'aria-label': options.searchLabel ?? 'Search...',
    name: options.name ? `${options.name}--keyword` : undefined,
    placeholder: options.searchLabel ?? 'Search...',
    autocomplete: 'off',
    spellcheck: 'false',
    type: 'text',
    class: 'ohne-dynamic-select-keyword-input',
    onInput: () => {
      keyword.value = keywordInput.value;
      onKeywordInput();
    },
  }) as HTMLInputElement;

  effect(() => {
    if (keywordInput.value !== keyword.value) keywordInput.value = keyword.value;
  });

  const scrollableEl = scrollable(
    [
      h(
        'div',
        {
          class: () =>
            'ohne-dynamic-select-keyword' +
            (topButtonVisible.value ? ' ohne-dynamic-select-keyword-offset' : ''),
        },
        keywordInput,
      ),
      () => choices.value.map(choiceRow),
      when(
        () => choices.value.length === 0,
        () =>
          h(
            'span',
            { class: 'ohne-dynamic-select-no-results' },
            h('span', null, options.noResultsLabel ?? 'No results found'),
          ),
      ),
    ],
    {
      onScrollStep: scrollChoices,
      expose: (handle) => {
        scroll = handle;
      },
    },
  );

  effect(() => {
    topButtonVisible.value = scroll.isTopButtonVisible.value;
  });

  const combobox = h(
    'div',
    {
      role: 'combobox',
      // A literal source quirk: the original carries `type="text"` on this div.
      type: 'text',
      'aria-expanded': () => (isExpanded.value ? 'true' : 'false'),
      tabindex: () => (disabled() ? -1 : 0),
      class: () =>
        'ohne-dynamic-select' +
        (error() ? ' ohne-dynamic-select-has-errors' : '') +
        (disabled() ? ' ohne-dynamic-select-disabled' : '') +
        (isExpanded.value ? ' ohne-dynamic-select-expanded' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onClick: () => {
        if (!disabled()) toggle();
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          if (isExpanded.value) focusNext();
          else void open();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          if (isExpanded.value) focusPrevious();
          else void open();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          void selectHighlightedOrClose(event);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (isExpanded.value) close(event);
          else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        } else if (event.key === ' ') {
          selectHighlightedOrToggle(event);
        } else if (event.key === 'Tab') {
          focusFirst(event);
        }
      },
      onMousemove: () => unpauseMouseDelayed(),
    },
    () => {
      const selected = selectedChoice.value;
      if (selected) {
        return h('span', { class: 'ohne-dynamic-select-selected-choice' }, labelOrDash(selected));
      }
      if (options.placeholder) {
        return h('span', { class: 'ohne-dynamic-select-placeholder' }, options.placeholder);
      }
      return null;
    },
    () =>
      selectedChoice.value?.badge
        ? h('span', { class: 'ohne-dynamic-select-badge' }, selectedChoice.value.badge)
        : null,
    fieldIcon('selector'),
    h(
      'div',
      {
        class: 'ohne-dynamic-select-choices',
        style: () =>
          (choicesHeight.value ? `height: ${choicesHeight.value}px; ` : '') +
          `transform: translate3d(0, ${choicesTopOffset.value}px, 0)`,
        onClick: (event: MouseEvent) => event.stopPropagation(),
      },
      scrollableEl,
    ),
  );

  // Replaces the source's async setup: the selected choice resolves after construction, and
  // a resolve is dropped when the model moved on while it was in flight.
  effect(() => {
    const value = model.value;
    untracked(() => {
      if (value === null) {
        selectedChoice.value = null;
      } else if (value !== selectedChoice.value?.value) {
        void options.selectedChoiceResolver(value).then((choice) => {
          if (untracked(() => model.value) === value) selectedChoice.value = choice;
        });
      }
    });
  });

  // Load the next page when the list rests at the bottom while more pages exist.
  effect(() => {
    const hasArrived = scroll.arrivedBottom.value;
    untracked(() => {
      if (
        isExpanded.value &&
        hasArrived &&
        !scroll.arrivedTop.value &&
        currentPage < lastPage &&
        !isLoadingMore
      ) {
        isLoadingMore = true;
        const fc = ++fetchCounter;
        void options.choicesResolver(currentPage + 1, keyword.value).then((page) => {
          if (fc === fetchCounter) {
            choices.value = [...choices.value, ...page.choices];
            currentPage = page.currentPage;
            updateSizes();
          }
          isLoadingMore = false;
        });
      }
    });
  });

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (!disabled()) combobox.focus();
    });
  }

  setTimeout(() => {
    const duration = getComputedStyle(document.body).getPropertyValue(
      '--ohne-overlay-transition-duration',
    );
    transitionDuration = duration.endsWith('ms')
      ? Number.parseInt(duration, 10)
      : duration.endsWith('s')
        ? Number.parseFloat(duration) * 1000
        : 300;
  });

  onCleanup(() => {
    close();
    clearTimeout(unpauseMouseTimeout);
  });

  return h(
    'div',
    {
      class: 'ohne-dynamic-select-wrapper',
      title: () => {
        const selected = selectedChoice.value;
        return !selected || isExpanded.value ? null : (selected.label ?? String(selected.value));
      },
    },
    combobox,
    h('input', {
      id: options.id,
      name: options.name,
      value: () => (isNullish(model.value) ? '' : String(model.value)),
      hidden: true,
    }),
  );
}
