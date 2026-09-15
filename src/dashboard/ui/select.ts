import type { Ref } from '../../utils/reactive/ref.ts';

import { last } from '../../utils/array/last.ts';
import { next } from '../../utils/array/next.ts';
import { prev } from '../../utils/array/prev.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { searchByKeywords } from '../../utils/search/search-by-keywords.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { lockScroll } from './_scroll-lock.ts';
import { type Primitive } from './button-group.ts';
import { nearestContainer } from './container.ts';
import { icon } from './icon.ts';
import { listenClickOutside } from './overlay.ts';
import { type ScrollableHandle, scrollable } from './scrollable.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * One choice a `select` offers.
 */
export interface SelectChoice {
  /**
   * An optional label to display for the choice in the select field.
   * If not provided, the `value` is displayed instead.
   */
  label?: string;

  /**
   * The value of the choice in the select field.
   * It must be unique across all choices and groups.
   */
  value: Primitive;

  /**
   * Indicates whether the choice is disabled.
   *
   * @default
   * false
   */
  disabled?: boolean;

  /**
   * Indicates whether the choice is visually muted in the UI.
   *
   * @default
   * false
   */
  muted?: boolean;
}

/**
 * A labeled group of `select` choices.
 */
export interface SelectChoiceGroup {
  /**
   * Text that describes a group of selectable options.
   * The label renders as a sticky row above the group's choices.
   */
  group: string;

  /**
   * The choices shown in the group.
   * Each choice requires a `value` distinct across all groups and choices.
   */
  choices: SelectChoice[];
}

/**
 * Options for `select`.
 */
export interface SelectOptions {
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
   */
  name?: string;

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
  .ohne-select-wrapper {
    width: 100%;
  }

  .ohne-select {
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

  .ohne-select-expanded {
    cursor: default;
  }

  .ohne-select-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-select:not(.ohne-select-disabled):focus,
  .ohne-select:not(.ohne-select-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-select-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    cursor: default;
    background-color: hsl(var(--ohne-muted));
    box-shadow: none;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-select-selected-choice,
  .ohne-select-placeholder {
    margin: auto 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-select-selected-choice-muted,
  .ohne-select-placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-select-icon {
    flex-shrink: 0;
    margin-left: auto;
  }

  .ohne-select-choices {
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

  .ohne-select-expanded .ohne-select-choices {
    height: calc(100% + 2px);
    visibility: visible;
    transition: var(--ohne-transition);
    transition-property: height, visibility, transform;
  }

  .ohne-select-choice,
  .ohne-select-group-label {
    display: flex;
    align-items: center;
    color: hsl(var(--ohne-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-select-choice span,
  .ohne-select-group-label span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-select-choice {
    width: 100%;
    height: calc(2em + 0.25rem - 2px);
    padding: 0 calc(0.5em - 1px);
    border: 1px solid hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    cursor: pointer;
  }

  .ohne-select-choice-selected {
    display: flex;
    justify-content: space-between;
    gap: 1em;
    padding-right: calc(0.5em + 1px);
  }

  .ohne-select-choice-highlighted {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-select-choice-disabled,
  .ohne-select-choice-muted {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-select-group .ohne-select-choice {
    padding-left: 1em;
  }

  .ohne-select-group-label {
    position: sticky;
    top: 0;
    width: calc(100% + 2px);
    height: calc(2em + 0.25rem);
    margin: -1px;
    padding: 0 0.5em;
    font-weight: 600;
    background-color: hsl(var(--ohne-background));
    transition: var(--ohne-transition);
    transition-property: top;
  }

  .ohne-select-group-label-offset {
    top: 1em;
  }
`;

/**
 * Creates the named icon at 1.125em, classed to sit at the trailing end of its row.
 */
function fieldIcon(name: 'selector' | 'check'): SVGSVGElement {
  const svg = icon(name);
  svg.classList.add('ohne-select-icon');
  svg.setAttribute('width', '1.125em');
  svg.setAttribute('height', '1.125em');
  return svg;
}

/**
 * Renders a choice value as text, with `null` and `undefined` as the empty string.
 */
function toDisplay(value: Primitive): string {
  return isNullish(value) ? '' : String(value);
}

/**
 * The static single-select combobox.
 *
 * The choices expand in place: an absolutely positioned overlay grows over the field, capped at 12 rows.
 * It translates upward just enough to fit, clamped to the window or `scrollContainer`.
 * Arrows highlight with clamped ends, Enter selects, Space selects or toggles.
 * Tab highlights the first choice while open; typing runs a 750ms-windowed typeahead underlining the match.
 * Hover highlighting pauses after keyboard moves until the mouse really travels again.
 * A trailing hidden input carries `id` and `name` for label linkage and form serialization.
 *
 * @example
 * ```ts
 * const timezone = ref<Primitive>('utc')
 * select(timezone, () => [
 *   { label: 'UTC', value: 'utc' },
 *   { group: 'Europe', choices: [{ label: 'Central European Time', value: 'cet' }] },
 * ])
 * ```
 */
export function select(
  model: Ref<Primitive>,
  choices: () => (SelectChoice | SelectChoiceGroup)[],
  options: SelectOptions = {},
): HTMLElement {
  const error = options.error ?? ((): boolean => false);
  const disabled = options.disabled ?? ((): boolean => false);
  const isExpanded = ref(false);
  const highlightedChoice = ref<SelectChoice | undefined>(undefined);
  const choicesHeight = ref<number | undefined>(undefined);
  const choicesTopOffset = ref(0);
  const mousePaused = ref(false);
  const keywordHighlight = ref<[number, number]>([-1, -1]);
  const keywordPending = ref(false);
  const topButtonVisible = ref(false);

  let scroll!: ScrollableHandle;
  let keyword = '';
  let keywordTimer: ReturnType<typeof setTimeout> | undefined;
  let unpauseMouseTimeout: ReturnType<typeof setTimeout> | undefined;
  let stopOutsideClick: (() => void) | undefined;
  let stopResize: (() => void) | undefined;
  let unlockWindow: (() => void) | undefined;
  let unlockContainer: (() => void) | undefined;

  const flatChoices = (): SelectChoice[] =>
    choices().flatMap((choice) => ('group' in choice ? choice.choices : choice));

  const enabledChoices = (): SelectChoice[] => flatChoices().filter((choice) => !choice.disabled);

  const selectedChoice = computed(() =>
    flatChoices().find((choice) => choice.value === model.value),
  );

  const startKeywordTimer = (): void => {
    keywordPending.value = true;
    clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => {
      keywordPending.value = false;
    }, 750);
  };
  startKeywordTimer();

  const calcItemSizes = (): { baseFontSize: number; em: number; itemHeight: number } => {
    const baseFontSize = +getComputedStyle(document.documentElement)
      .getPropertyValue('font-size')
      .slice(0, -2);
    const sizeVar = getComputedStyle(combobox).getPropertyValue('--ohne-size');
    const size = sizeVar ? +sizeVar : 0;
    const em = baseFontSize + size * 0.125 * baseFontSize;
    return { baseFontSize, em, itemHeight: 2 * em + 0.25 * baseFontSize - 2 };
  };

  const open = (event?: Event): void => {
    if (isExpanded.value) return;
    isExpanded.value = true;
    combobox.addEventListener('keydown', search);
    stopOutsideClick = listenClickOutside(combobox, () => close());
    const onResize = (): void => close();
    window.addEventListener('resize', onResize);
    stopResize = () => window.removeEventListener('resize', onResize);
    const pane = options.scrollContainer ?? nearestContainer(combobox);
    unlockWindow = lockScroll(document.documentElement);
    unlockContainer = pane ? lockScroll(pane) : undefined;

    const items = choices().reduce(
      (acc, choice) => acc + ('group' in choice ? choice.choices.length + 1 : 1),
      0,
    );
    const { itemHeight } = calcItemSizes();
    const rootRect = combobox.getBoundingClientRect();
    const container = pane;
    const parentHeight = container ? container.offsetHeight : window.innerHeight;
    const rootTop = container ? rootRect.top - container.getBoundingClientRect().top : rootRect.top;
    const rootBottom = parentHeight - rootTop;

    let height = 0;
    let overflows = false;
    for (let i = 1; i <= Math.min(items, 12); i++) {
      height += itemHeight;
      if (height + 4 > parentHeight) {
        height = parentHeight - 6;
        overflows = true;
        break;
      }
    }

    let panelHeight = height + 2;
    let topOffset = 0;
    if (rootBottom <= panelHeight) {
      topOffset = rootBottom - panelHeight - 2 + 4;
      if (overflows) panelHeight -= 8;
      else topOffset -= 8;
    }
    choicesHeight.value = panelHeight;
    choicesTopOffset.value = topOffset;

    highlightedChoice.value = selectedChoice.value;
    scrollToHighlighted();
    mousePaused.value = true;
    event?.preventDefault();
  };

  const close = (event?: Event): void => {
    if (!isExpanded.value) return;
    isExpanded.value = false;
    highlightedChoice.value = undefined;
    combobox.removeEventListener('keydown', search);
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
    event?.preventDefault();
  };

  const toggle = (event?: Event): void => {
    if (isExpanded.value) close(event);
    else open(event);
  };

  const focusPrevious = (event?: Event): void => {
    open(event);
    const pool = enabledChoices();
    highlightedChoice.value = highlightedChoice.value
      ? prev(highlightedChoice.value, pool, { prop: 'value' })
      : last(pool);
    mousePaused.value = true;
    scrollToHighlighted();
  };

  const focusNext = (event?: Event): void => {
    open(event);
    const pool = enabledChoices();
    highlightedChoice.value = highlightedChoice.value
      ? next(highlightedChoice.value, pool, { prop: 'value' })
      : pool[0];
    mousePaused.value = true;
    scrollToHighlighted();
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
      emitValue(highlighted.value);
      close(event);
    }
  };

  const selectHighlightedOrClose = (event?: Event): void => {
    if (isExpanded.value) {
      if (highlightedChoice.value) selectHighlighted(event);
      else close(event);
    }
  };

  const selectHighlightedOrToggle = (event?: Event): void => {
    if (isExpanded.value && highlightedChoice.value) selectHighlighted(event);
    else toggle(event);
  };

  const emitValue = (value: Primitive): void => {
    options.onCommit?.(value);
    model.value = value;
  };

  const scrollToHighlighted = (): void => {
    const { em, itemHeight } = calcItemSizes();
    let offset = 0;
    let found = false;
    for (const entry of choices()) {
      if ('group' in entry) {
        for (const { value } of entry.choices) {
          if (value === highlightedChoice.value?.value) {
            found = true;
            break;
          }
          offset++;
        }
      } else if (entry.value === highlightedChoice.value?.value) {
        found = true;
      }
      if (found) break;
      offset++;
    }
    let top = found ? itemHeight * offset : 0;
    // Reduce the top offset by the height of the top scroll button.
    if (top > 0 && (!scroll.arrivedTop.value || !scroll.arrivedBottom.value)) top -= em;
    scrollableEl.scrollTo({ top, behavior: 'instant' });
  };

  const scrollChoices = (direction: 'up' | 'down'): void => {
    if (isExpanded.value && !mousePaused.value) {
      const { itemHeight } = calcItemSizes();
      scrollableEl.scrollTo({
        top: scrollableEl.scrollTop + (direction === 'up' ? -itemHeight : itemHeight),
        behavior: 'instant',
      });
    }
  };

  const search = (event: KeyboardEvent): void => {
    if (!isExpanded.value) return;
    if (!keywordPending.value) {
      keyword = '';
      keywordHighlight.value = [-1, -1];
    }
    if (!event.ctrlKey && !event.metaKey && /^[\p{L}\p{N}]$/u.test(event.key)) {
      keyword += event.key;
      const found = searchByKeywords(enabledChoices(), keyword, ['label', 'value'])[0];
      if (found) {
        highlightedChoice.value = found;
        const keywordIndex = (found.label ?? (isString(found.value) ? found.value : ''))
          .toLowerCase()
          .indexOf(keyword.toLowerCase());
        scrollToHighlighted();
        mousePaused.value = true;
        keywordHighlight.value =
          keywordIndex > -1 ? [keywordIndex, keywordIndex + keyword.length - 1] : [-1, -1];
      } else {
        keywordHighlight.value = [-1, -1];
      }
      startKeywordTimer();
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

  const choiceRow = (choice: SelectChoice): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: () => {
          let classes = 'ohne-select-choice ohne-raw';
          if (choice.value === model.value) classes += ' ohne-select-choice-selected';
          if (choice.value === highlightedChoice.value?.value) {
            classes += ' ohne-select-choice-highlighted';
          }
          if (choice.disabled) classes += ' ohne-select-choice-disabled';
          if (choice.muted) classes += ' ohne-select-choice-muted';
          return classes;
        },
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          if (!choice.disabled) {
            emitValue(choice.value);
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
      () => {
        if (
          choice.value === highlightedChoice.value?.value &&
          choice.label &&
          keywordPending.value
        ) {
          const [from, to] = keywordHighlight.value;
          return h(
            'span',
            null,
            choice.label
              .split('')
              .map((char, index) => h(index >= from && index <= to ? 'u' : 'span', null, char)),
          );
        }
        return h(
          'span',
          { title: choice.label ?? String(choice.value) },
          choice.label ?? toDisplay(choice.value),
        );
      },
      when(
        () => choice.value === model.value,
        () => fieldIcon('check'),
      ),
    );

  const scrollableEl = scrollable(
    () =>
      choices().map((entry) =>
        'group' in entry
          ? h(
              'div',
              { class: 'ohne-select-group' },
              h(
                'span',
                {
                  class: () =>
                    'ohne-select-group-label' +
                    (topButtonVisible.value ? ' ohne-select-group-label-offset' : ''),
                },
                entry.group,
              ),
              entry.choices.map(choiceRow),
            )
          : choiceRow(entry),
      ),
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
      type: 'text',
      'aria-expanded': () => (isExpanded.value ? 'true' : 'false'),
      tabindex: () => (disabled() ? -1 : 0),
      class: () =>
        'ohne-select' +
        (error() ? ' ohne-select-has-errors' : '') +
        (disabled() ? ' ohne-select-disabled' : '') +
        (isExpanded.value ? ' ohne-select-expanded' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onClick: () => {
        if (!disabled()) toggle();
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          if (isExpanded.value) focusNext();
          else open();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          if (isExpanded.value) focusPrevious();
          else open();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          selectHighlightedOrClose(event);
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
      if (selected && (selected.label || selected.value)) {
        return h(
          'span',
          {
            class:
              'ohne-select-selected-choice' +
              (selected.muted ? ' ohne-select-selected-choice-muted' : ''),
          },
          selected.label ?? toDisplay(selected.value),
        );
      }
      if (options.placeholder) {
        return h('span', { class: 'ohne-select-placeholder' }, options.placeholder);
      }
      return null;
    },
    fieldIcon('selector'),
    h(
      'div',
      {
        class: 'ohne-select-choices',
        style: () =>
          (choicesHeight.value ? `height: ${choicesHeight.value}px; ` : '') +
          `transform: translate3d(0, ${choicesTopOffset.value}px, 0)`,
        onClick: (event: MouseEvent) => event.stopPropagation(),
      },
      scrollableEl,
    ),
  );

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (!disabled()) combobox.focus();
    });
  }

  onCleanup(() => {
    close();
    clearTimeout(keywordTimer);
    clearTimeout(unpauseMouseTimeout);
  });

  return h(
    'div',
    {
      class: 'ohne-select-wrapper',
      title: () => {
        const selected = selectedChoice.value;
        return !selected || isExpanded.value ? null : (selected.label ?? String(selected.value));
      },
    },
    combobox,
    h('input', {
      id: options.id,
      name: options.name,
      value: () => toDisplay(model.value),
      hidden: true,
    }),
  );
}
