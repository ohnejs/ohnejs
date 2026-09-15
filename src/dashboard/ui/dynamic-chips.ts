import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { debounce } from '../../utils/debounce/debounce.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { lockScroll } from './_scroll-lock.ts';
import { type Primitive } from './button-group.ts';
import { nearestContainer } from './container.ts';
import { type DropdownHandle, dropdown } from './dropdown.ts';
import { icon } from './icon.ts';
import { listenClickOutside } from './overlay.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * One choice a `dynamicChips` resolver returns.
 */
export interface DynamicChipsChoice {
  /**
   * An optional label to display for the choice in the chips field.
   * If not provided, the `value` is displayed instead.
   */
  label?: string;

  /**
   * An optional detail to display for the choice in the dropdown.
   * It is displayed in a grayed out style below the label.
   */
  detail?: string;

  /**
   * An optional tooltip text to display for the choice's chip.
   */
  tooltip?: string;

  /**
   * The value of the choice in the chips field.
   */
  value: Primitive;
}

/**
 * One page of resolved `dynamicChips` choices.
 */
export interface DynamicChipsPaginatedChoices {
  /**
   * The choices of this page.
   */
  choices: DynamicChipsChoice[];

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
 * Options for `dynamicChips`.
 */
export interface DynamicChipsOptions {
  /**
   * Resolves the choices for the chips field.
   * It receives the 1-based `page` and the search `keyword`.
   */
  choicesResolver: (page: number, keyword: string) => Promise<DynamicChipsPaginatedChoices>;

  /**
   * Resolves the selected choices based on their values.
   */
  selectedChoicesResolver: (values: Primitive[]) => Promise<DynamicChipsChoice[]>;

  /**
   * Ensures all items in the array are unique.
   * Already picked values vanish from the dropdown.
   *
   * @default
   * true
   */
  enforceUniqueItems?: boolean;

  /**
   * The maximum number of items allowed in the array.
   * `false` disables the limit.
   *
   * @default
   * false
   */
  maxItems?: number | false;

  /**
   * The minimum number of items allowed in the array.
   * The component never enforces it; check the count yourself.
   *
   * @default
   * false
   */
  minItems?: number | false;

  /**
   * Text label for the remove item button.
   *
   * @default
   * 'Remove'
   */
  removeItemLabel?: string;

  /**
   * Text label for the no results found message in the choices dropdown.
   *
   * @default
   * 'No results found'
   */
  noResultsLabel?: string;

  /**
   * The visual style variant of the chips.
   *
   * @default
   * 'accent'
   */
  variant?: 'primary' | 'secondary' | 'accent';

  /**
   * Adjusts the size of the component, from -2 (very small) to 2 (very large).
   * Omitted, the value is inherited as `--ohne-size` from the parent element.
   */
  size?: number;

  /**
   * Placeholder text shown while the text input is empty.
   */
  placeholder?: string;

  /**
   * The long-press duration in milliseconds that starts dragging on touch devices.
   *
   * @default
   * 500
   */
  touchDuration?: number;

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Indices of items with errors, read reactively; those chips render destructive.
   * The marks clear whenever the model changes.
   */
  erroredItems?: () => number[];

  /**
   * Disables the input reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input element; the text input takes `<id>--input`.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input element; the text input takes `<name>--input`.
   */
  name?: string;

  /**
   * A scrollable ancestor, scroll-locked while the dropdown is open.
   * The window locks regardless.
   * Omitted, the control's nearest `.ohne-container` ancestor stands in.
   */
  scrollContainer?: HTMLElement;

  /**
   * Called when a chip is double-clicked, with its value and the mouse event.
   * Consumers open edit popups from here.
   */
  onDblclick?: (value: Primitive, event: MouseEvent) => void;

  /**
   * Custom chip content, replacing the tooltip'd ellipsis label.
   */
  label?: (payload: { choice: DynamicChipsChoice; index: number }) => Child;

  /**
   * Custom dropdown row content, replacing the label plus optional detail line.
   */
  choice?: (payload: { choice: DynamicChipsChoice; index: number }) => Child;
}

css`
  .ohne-dynamic-chips {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-height: calc(2em + 0.25rem);
    padding: 0.125rem;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-dynamic-chips-focused:not(.ohne-dynamic-chips-disabled):not(
      .ohne-dynamic-chips-dropdown-visible
    ),
  .ohne-dynamic-chips:not(.ohne-dynamic-chips-disabled):not(
      .ohne-dynamic-chips-dropdown-visible
    ):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-dynamic-chips-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-dynamic-chips-disabled.ohne-dynamic-chips-empty {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-chips-list {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    height: 100%;
    gap: 0.125rem;
  }

  .ohne-dynamic-chips-item {
    display: flex;
    align-items: center;
    height: calc(2em - 0.125rem);
    gap: 0.375em;
    padding: 0 0.5em;
    user-select: none;
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, color, box-shadow;
  }

  .ohne-dynamic-chips:not(.ohne-dynamic-chips-disabled) .ohne-dynamic-chips-item {
    cursor: move;
  }

  .ohne-dynamic-chips-primary .ohne-dynamic-chips-item {
    --ohne-background: var(--ohne-primary);
    --ohne-foreground: var(--ohne-primary-foreground);
  }

  .ohne-dynamic-chips-secondary .ohne-dynamic-chips-item {
    --ohne-background: var(--ohne-secondary);
    --ohne-foreground: var(--ohne-secondary-foreground);
  }

  .ohne-dynamic-chips-accent .ohne-dynamic-chips-item,
  .ohne-dynamic-chips-primary.ohne-dynamic-chips-dragging
    .ohne-dynamic-chips-item:not(.ohne-dynamic-chips-item-dragging) {
    --ohne-background: var(--ohne-accent);
    --ohne-foreground: var(--ohne-accent-foreground);
  }

  .ohne-dynamic-chips .ohne-dynamic-chips-item-destructive {
    --ohne-background: var(--ohne-destructive);
    --ohne-foreground: var(--ohne-destructive-foreground);
  }

  .ohne-dynamic-chips-disabled .ohne-dynamic-chips-item,
  .ohne-dynamic-chips .ohne-dynamic-chips-item-dragging {
    --ohne-background: var(--ohne-muted);
    --ohne-foreground: var(--ohne-muted-foreground);
  }

  .ohne-dynamic-chips-label {
    margin-top: -0.0625em;
    overflow: hidden;
    white-space: pre;
    text-overflow: ellipsis;
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
  }

  .ohne-dynamic-chips-remove {
    flex-shrink: 0;
    border-radius: 50%;
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-dynamic-chips-remove:disabled {
    pointer-events: none;
  }

  .ohne-dynamic-chips-remove:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-destructive-foreground)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-dynamic-chips-dropzone {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    width: 0.5rem;
    margin: 0 -0.3125rem;
    height: calc(2em - 0.125rem);
    opacity: 0;
  }

  .ohne-dynamic-chips-dropzone::before {
    content: '';
    flex-shrink: 0;
    width: 0.125rem;
    height: 100%;
    background-color: hsl(var(--ohne-foreground));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-dynamic-chips-dropzone:hover,
  .ohne-dynamic-chips-dragging-touch .ohne-dynamic-chips-dropzone {
    opacity: 1;
  }

  .ohne-dynamic-chips-input {
    flex: 1;
    display: flex;
    min-width: 5rem;
    height: calc(2em - 0.125rem);
    padding: 0 0.375em;
    overflow: hidden;
    background-color: transparent;
    border: none;
    outline: none;
    font-size: 1em;
    line-height: 1.25;
    color: hsl(var(--ohne-foreground));
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-dynamic-chips-input::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-chips-dropdown {
    width: var(--ohne-width);
  }

  .ohne-dynamic-chips-dropdown-item,
  .ohne-dynamic-chips-dropdown-item-label,
  .ohne-dynamic-chips-dropdown-item-detail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-dynamic-chips-dropdown-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 2em;
    padding: 0 0.5em;
    border: none;
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    color: hsl(var(--ohne-foreground));
    text-decoration: none;
    text-align: left;
  }

  .ohne-dynamic-chips-dropdown-item-detailed {
    height: 3em;
  }

  .ohne-dynamic-chips-dropdown-item-highlighted {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-dynamic-chips-dropdown-item-detail {
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875em;
  }

  .ohne-dynamic-chips-dropdown-no-results {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 2em;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-dynamic-chips-dropdown-no-results span {
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-dynamic-chips-dropdown .ohne-dropdown-scrollable {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }
`;

/**
 * Returns the choice's `label`, else its `value`, as text; any falsy result, `0` included, shows `-`.
 */
function labelOrDash(choice: DynamicChipsChoice): string {
  return String((choice.label ?? choice.value) || '-');
}

/**
 * The async multi-value chips field.
 *
 * Chips resolve through `selectedChoicesResolver`.
 * Addable choices search remotely with a 250ms debounce and paginate on scroll.
 * They render inside a width-matched `dropdown` that carries the focus ring.
 * Rows add on mousedown with prevented default, so the text input keeps focus for multi-adding.
 * Backspace deletes in two steps, previewing the last chip destructively before removing it.
 * Chips reorder by mouse drag or touch long-press onto the dropzones between them.
 * A trailing hidden input carries `id` and `name` for label linkage and form serialization.
 *
 * @example
 * ```ts
 * const tags = ref<Primitive[]>([])
 * dynamicChips(tags, {
 *   choicesResolver: (page, keyword) => api.searchTags(page, keyword),
 *   selectedChoicesResolver: (values) => api.resolveTags(values),
 * })
 * ```
 */
export function dynamicChips(model: Ref<Primitive[]>, options: DynamicChipsOptions): HTMLElement {
  const error = options.error ?? ((): boolean => false);
  const disabled = options.disabled ?? ((): boolean => false);
  const filteredChoices = ref<DynamicChipsChoice[]>([]);
  const selectedChoices = ref<DynamicChipsChoice[]>([]);
  const isFocused = ref(false);
  const isDropdownVisible = ref(false);
  const inputValue = ref('');
  const highlightedIndex = ref(0);
  const erroredItemsMap = ref<Record<number, boolean>>({});
  const backspaceIndex = ref<number | null>(null);
  const removeIndex = ref<number | null>(null);
  const draggingIndex = ref<number | null>(null);
  const isTouchDragging = ref(false);
  const dataInitialized = ref(false);
  const pointerEvents = ref(true);
  const hasDetails = ref(false);
  const dropdownRef = ref<DropdownHandle | null>(null);
  const dragStops: (() => void)[] = [];

  let root: HTMLElement | null = null;
  let choices: DynamicChipsChoice[] = [];
  let currentPage = 1;
  let lastPage = 1;
  let fetchCounter = 0;
  let isLoadingMore = false;
  let touchTimeout: ReturnType<typeof setTimeout> | undefined;
  let releaseOpen: (() => void) | undefined;

  const resolveChoices = async (): Promise<void> => {
    if (!isDropdownVisible.value) return;
    const fc = ++fetchCounter;
    const page = await options.choicesResolver(1, inputValue.value);
    if (isDropdownVisible.value && fc === fetchCounter && !deepEqual(page.choices, choices)) {
      choices = page.choices;
      currentPage = page.currentPage;
      lastPage = page.lastPage;
      hasDetails.value = page.choices[0]?.detail !== undefined;
      filterChoices();
    }
    dataInitialized.value = true;
  };

  const onInputValueChange = debounce(() => void resolveChoices(), 250);

  const filterChoices = (): void => {
    const enforceUnique = options.enforceUniqueItems ?? true;
    filteredChoices.value = choices.filter(
      (choice) => !enforceUnique || !model.value.includes(choice.value),
    );
    highlightedIndex.value = Math.min(
      filteredChoices.value.length - 1,
      highlightedIndex.value > -1 ? highlightedIndex.value : 0,
    );
    void nextTick().then(() => dropdownRef.value?.update());
  };

  const selectHighlightedChoice = (): void => {
    const highlightedValue = filteredChoices.value[highlightedIndex.value]?.value;
    if (highlightedValue !== undefined) {
      const maxItems = options.maxItems ?? false;
      if (maxItems === false || model.value.length < maxItems) {
        model.value = [...model.value, highlightedValue];
        void nextTick().then(filterChoices);
      }
    }
    // The typed keyword stays but is selected, so continuing to type starts a fresh search.
    input.select();
  };

  const focusPreviousChoice = (): void => {
    highlightedIndex.value = highlightedIndex.value - 1 < 0 ? 0 : highlightedIndex.value - 1;
    scrollToHighlightedChoice();
  };

  const focusNextChoice = (): void => {
    highlightedIndex.value =
      highlightedIndex.value + 1 >= filteredChoices.value.length
        ? filteredChoices.value.length - 1
        : highlightedIndex.value + 1;
    scrollToHighlightedChoice();
  };

  const scrollToHighlightedChoice = (): void => {
    const handle = dropdownRef.value;
    if (highlightedIndex.value > -1 && handle) {
      const { itemHeight, em } = handle.calcItemSizes();
      const realItemHeight = hasDetails.value ? itemHeight + em : itemHeight;
      let top = realItemHeight * highlightedIndex.value;
      if (
        top > 0 &&
        (!handle.scrollable.arrivedTop.value || !handle.scrollable.arrivedBottom.value)
      ) {
        top -= em;
      }
      // The programmatic scroll fires a synthetic mouseover that would steal the highlight.
      pointerEvents.value = false;
      handle.scrollable.y.value = top;
      setTimeout(() => {
        pointerEvents.value = true;
      });
    }
  };

  const handleDrag = (itemIndex: number, event: MouseEvent): void => {
    if (event.button > 0 || disabled()) return;

    const [x, y] = [event.clientX, event.clientY];

    const onMouseMove = (event: MouseEvent): void => {
      if (Math.abs(event.clientX - x) > 5 || Math.abs(event.clientY - y) > 5) {
        draggingIndex.value = itemIndex;
        isTouchDragging.value = false;
        stopMouseMove();
      }
    };
    const stopMouseMove = (): void => document.removeEventListener('mousemove', onMouseMove);
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stopDragging();
    };

    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', stopDragging);
    document.addEventListener('mouseup', stopDragging);
    window.addEventListener('keydown', onEscape);
    dragStops.push(
      stopMouseMove,
      () => window.removeEventListener('blur', stopDragging),
      () => document.removeEventListener('mouseup', stopDragging),
      () => window.removeEventListener('keydown', onEscape),
    );
  };

  const onTouchStart = (itemIndex: number): void => {
    if (!disabled()) {
      touchTimeout = setTimeout(() => {
        draggingIndex.value = itemIndex;
        isTouchDragging.value = true;
        clearTimeout(touchTimeout);
        const onDocumentTouchStart = (): void => stopDragging();
        document.addEventListener('touchstart', onDocumentTouchStart);
        dragStops.push(() => document.removeEventListener('touchstart', onDocumentTouchStart));
      }, options.touchDuration ?? 500);
    }
  };

  const drop = (index: number): void => {
    const from = draggingIndex.value;
    if (from !== null) {
      // A null placeholder keeps the target indices valid; the filter then drops it.
      const items = [...model.value];
      const dragged = items.splice(from, 1, null)[0];
      items.splice(index, 0, dragged);
      model.value = items.filter((item) => item !== null);
    }
  };

  const stopDragging = (): void => {
    draggingIndex.value = null;
    for (const stop of dragStops) stop();
    dragStops.length = 0;
  };

  const input = h('input', {
    disabled: () => {
      const maxItems = options.maxItems ?? false;
      return disabled() || (maxItems !== false && model.value.length >= maxItems);
    },
    id: options.id ? `${options.id}--input` : undefined,
    name: options.name ? `${options.name}--input` : undefined,
    placeholder: options.placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
    class: 'ohne-dynamic-chips-input',
    onFocus: () => {
      isFocused.value = true;
      isDropdownVisible.value = true;
      highlightedIndex.value = 0;
      dataInitialized.value = false;
    },
    onBlur: () => {
      isFocused.value = false;
      isDropdownVisible.value = false;
      backspaceIndex.value = null;
      removeIndex.value = null;
    },
    onInput: () => {
      inputValue.value = input.value;
    },
    onKeydown: (event: KeyboardEvent) => {
      if (backspaceIndex.value !== null && event.code !== 'Backspace') {
        removeIndex.value = null;
        backspaceIndex.value = null;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusNextChoice();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusPreviousChoice();
      } else if (event.key === 'Backspace') {
        if (!inputValue.value) {
          const at = backspaceIndex.value;
          if (at !== null && model.value[at] && at === removeIndex.value) {
            model.value = model.value.filter((_, i) => i !== at);
            removeIndex.value = null;
            backspaceIndex.value = null;
            void nextTick().then(filterChoices);
          } else {
            backspaceIndex.value = model.value.length ? model.value.length - 1 : null;
            removeIndex.value = backspaceIndex.value;
          }
        }
      } else if (event.key === 'Enter') {
        selectHighlightedChoice();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        input.blur();
      } else if (event.key === 'Tab') {
        input.blur();
      }
    },
  }) as HTMLInputElement;

  batchedEffect(() => {
    if (input.value !== inputValue.value) input.value = inputValue.value;
  });

  const dropzone = (target: () => number): HTMLElement =>
    h('span', {
      class: 'ohne-dynamic-chips-dropzone',
      onMouseup: () => drop(target()),
      onTouchstart: () => drop(target()),
    });

  const chipLabel = (choice: () => DynamicChipsChoice, index: () => number): Child => {
    const labelSlot = options.label;
    if (labelSlot) return () => labelSlot({ choice: choice(), index: index() });
    const el = h(
      'span',
      {
        class: 'ohne-dynamic-chips-label',
        title: () => choice().label ?? String(choice().value),
      },
      () => labelOrDash(choice()),
    );
    onCleanup(attachTooltip(el, () => choice().tooltip ?? null));
    return el;
  };

  const dropdownRow = (choice: DynamicChipsChoice, index: number): HTMLElement => {
    const choiceSlot = options.choice;
    return h(
      'button',
      {
        title: choice.label ?? String(choice.value),
        class: () =>
          'ohne-dynamic-chips-dropdown-item ohne-raw' +
          (highlightedIndex.value === index
            ? ' ohne-dynamic-chips-dropdown-item-highlighted'
            : '') +
          (hasDetails.value ? ' ohne-dynamic-chips-dropdown-item-detailed' : ''),
        onClick: (event: MouseEvent) => event.preventDefault(),
        onMousedown: (event: MouseEvent) => {
          event.preventDefault();
          model.value = [...model.value, choice.value];
          void nextTick().then(filterChoices);
        },
        onMouseenter: () => {
          if (pointerEvents.value) highlightedIndex.value = index;
        },
        onMousemove: () => {
          if (pointerEvents.value) highlightedIndex.value = index;
        },
      },
      choiceSlot
        ? choiceSlot({ choice, index })
        : [
            h('span', { class: 'ohne-dynamic-chips-dropdown-item-label' }, labelOrDash(choice)),
            choice.detail !== undefined
              ? h(
                  'span',
                  { class: 'ohne-dynamic-chips-dropdown-item-detail' },
                  choice.detail || '-',
                )
              : null,
          ],
    );
  };

  root = h(
    'div',
    {
      class: () =>
        'ohne-dynamic-chips' +
        (error() ? ' ohne-dynamic-chips-has-errors' : '') +
        (disabled() ? ' ohne-dynamic-chips-disabled' : '') +
        (isFocused.value ? ' ohne-dynamic-chips-focused' : '') +
        (isDropdownVisible.value ? ' ohne-dynamic-chips-dropdown-visible' : '') +
        (model.value.length === 0 ? ' ohne-dynamic-chips-empty' : '') +
        (draggingIndex.value !== null ? ' ohne-dynamic-chips-dragging' : '') +
        (draggingIndex.value !== null && isTouchDragging.value
          ? ' ohne-dynamic-chips-dragging-touch'
          : '') +
        ` ohne-dynamic-chips-${options.variant ?? 'accent'}`,
      style: () => {
        void isDropdownVisible.value;
        return (
          (options.size === undefined ? '' : `--ohne-size: ${options.size}; `) +
          (root ? `--ohne-width: ${root.offsetWidth}px` : '')
        );
      },
    },
    h(
      'ul',
      { class: 'ohne-dynamic-chips-list' },
      each(
        () => selectedChoices.value,
        (_, index) => index,
        (choice, index) => [
          when(
            () => draggingIndex.value !== null,
            () => dropzone(() => index()),
          ),
          h(
            'li',
            {
              class: () =>
                'ohne-dynamic-chips-item' +
                (draggingIndex.value === index() ? ' ohne-dynamic-chips-item-dragging' : '') +
                (erroredItemsMap.value[index()] || removeIndex.value === index()
                  ? ' ohne-dynamic-chips-item-destructive'
                  : ''),
              onDblclick: (event: MouseEvent) => options.onDblclick?.(choice().value, event),
              onMousedown: (event: MouseEvent) => handleDrag(index(), event),
              onTouchstart: (event: TouchEvent) => {
                event.preventDefault();
                onTouchStart(index());
              },
            },
            chipLabel(choice, index),
            when(
              () => !disabled(),
              () =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ohne-dynamic-chips-remove ohne-raw',
                    disabled: () => draggingIndex.value !== null,
                    title: options.removeItemLabel ?? 'Remove',
                    onClick: () => {
                      const at = index();
                      model.value = model.value.filter((_, i) => i !== at);
                      void nextTick().then(filterChoices);
                      removeIndex.value = null;
                    },
                    onFocus: () => {
                      removeIndex.value = index();
                    },
                    onMouseenter: () => {
                      removeIndex.value = index();
                    },
                    onBlur: () => {
                      removeIndex.value = null;
                    },
                    onMouseleave: () => {
                      removeIndex.value = null;
                    },
                    onTouchstart: (event: TouchEvent) => event.stopPropagation(),
                  },
                  icon('x'),
                ),
            ),
          ),
          when(
            () => draggingIndex.value !== null,
            () => dropzone(() => index() + 1),
          ),
        ],
      ),
      input,
    ),
    when(
      () => isDropdownVisible.value && dataInitialized.value,
      () => {
        const handle = dropdown(
          [
            () => filteredChoices.value.map((choice, index) => dropdownRow(choice, index)),
            when(
              () => filteredChoices.value.length === 0,
              () =>
                h(
                  'span',
                  { class: 'ohne-dynamic-chips-dropdown-no-results' },
                  h('span', null, options.noResultsLabel ?? 'No results found'),
                ),
            ),
          ],
          {
            handleControls: false,
            offset: 7,
            reference: root ?? undefined,
            restoreFocus: false,
            inheritColors: true,
            class: 'ohne-dynamic-chips-dropdown',
            onClose: () => {
              isDropdownVisible.value = false;
            },
          },
        );
        dropdownRef.value = handle;
        onCleanup(() => {
          dropdownRef.value = null;
        });
        return handle.root;
      },
    ),
    h('input', {
      id: options.id,
      name: options.name,
      value: () => String(model.value),
      hidden: true,
    }),
  );

  effect(() => {
    const value = model.value;
    untracked(() => {
      if (value.length === 0) {
        selectedChoices.value = [];
      } else if (
        !deepEqual(
          value,
          selectedChoices.value.map((choice) => choice.value),
        )
      ) {
        void options.selectedChoicesResolver(value).then((resolved) => {
          if (untracked(() => model.value) === value) selectedChoices.value = resolved;
        });
      }
      erroredItemsMap.value = {};
      filterChoices();
    });
  });

  effect(() => {
    const map: Record<number, boolean> = {};
    for (const index of options.erroredItems?.() ?? []) map[index] = true;
    erroredItemsMap.value = map;
  });

  effect(() => {
    if (draggingIndex.value === null) document.body.style.removeProperty('cursor');
    else document.body.style.cursor = 'move';
  });

  effect(() => {
    void inputValue.value;
    untracked(() => onInputValueChange());
  });

  effect(() => {
    if (isDropdownVisible.value) {
      untracked(() => {
        const unlockWindow = lockScroll(document.documentElement);
        const pane = options.scrollContainer ?? nearestContainer(input);
        const unlockContainer = pane ? lockScroll(pane) : undefined;
        const stopOutsideClick = listenClickOutside(root as HTMLElement, () => input.blur());
        const onResize = (): void => input.blur();
        window.addEventListener('resize', onResize);
        releaseOpen = () => {
          stopOutsideClick();
          window.removeEventListener('resize', onResize);
          unlockWindow();
          unlockContainer?.();
        };
        void resolveChoices();
      });
    } else {
      releaseOpen?.();
      releaseOpen = undefined;
    }
  });

  effect(() => {
    const handle = dropdownRef.value;
    const hasArrived = handle ? handle.scrollable.arrivedBottom.value : false;
    untracked(() => {
      if (
        isDropdownVisible.value &&
        hasArrived &&
        handle &&
        !handle.scrollable.arrivedTop.value &&
        currentPage < lastPage &&
        !isLoadingMore
      ) {
        isLoadingMore = true;
        const fc = ++fetchCounter;
        void options.choicesResolver(currentPage + 1, inputValue.value).then((page) => {
          if (fc === fetchCounter) {
            choices = [...choices, ...page.choices];
            currentPage = page.currentPage;
            filterChoices();
          }
          isLoadingMore = false;
        });
      }
    });
  });

  const onTouchEnd = (): void => clearTimeout(touchTimeout);
  window.addEventListener('touchend', onTouchEnd);

  onCleanup(() => {
    document.body.style.removeProperty('cursor');
    clearTimeout(touchTimeout);
    window.removeEventListener('touchend', onTouchEnd);
    for (const stop of dragStops) stop();
    dragStops.length = 0;
    releaseOpen?.();
    releaseOpen = undefined;
    onInputValueChange.cancel();
  });

  return root;
}
