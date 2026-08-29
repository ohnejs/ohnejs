import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { searchByKeywords } from '../../utils/search/search-by-keywords.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { nearestContainer } from './container.ts';
import { type DropdownHandle, dropdown } from './dropdown.ts';
import { icon } from './icon.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * One choice in a `chips` field running in select mode.
 */
export interface ChipsChoice {
  /**
   * An optional label to display for the choice.
   * If not provided, the `value` is displayed instead.
   */
  label?: string;

  /**
   * The value of the choice.
   * It must be unique among the choices.
   */
  value: string;

  /**
   * An optional tooltip text to display for the choice.
   */
  tooltip?: string;
}

/**
 * Options for `chips`.
 */
export interface ChipsOptions {
  /**
   * The available choices, read reactively.
   * When given, the input behaves like a select dropdown and only listed values are addable.
   * Omitted, any text can be entered.
   */
  choices?: () => ChipsChoice[];

  /**
   * Trims and collapses whitespace in the typed value.
   *
   * @default
   * true
   */
  trim?: boolean;

  /**
   * Ensures all items in the array are unique.
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
   * Text label for the remove item button.
   *
   * @default
   * 'Remove'
   */
  removeItemLabel?: string;

  /**
   * Text label for the no-results message in the choices dropdown.
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
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
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
   * The surrounding scroll container, scroll-locked while the dropdown is open.
   * The window locks regardless.
   * Omitted, the control's nearest `.ohne-container` ancestor stands in.
   */
  scrollContainer?: HTMLElement;
}

css`
  .ohne-chips {
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

  .ohne-chips-focused:not(.ohne-chips-disabled):not(.ohne-chips-dropdown-visible),
  .ohne-chips:not(.ohne-chips-disabled):not(.ohne-chips-dropdown-visible):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-chips-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-chips-disabled.ohne-chips-empty {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-chips-list {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    height: 100%;
    gap: 0.125rem;
  }

  .ohne-chips-item {
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

  .ohne-chips:not(.ohne-chips-disabled) .ohne-chips-item {
    cursor: move;
  }

  .ohne-chips-primary .ohne-chips-item {
    --ohne-background: var(--ohne-primary);
    --ohne-foreground: var(--ohne-primary-foreground);
  }

  .ohne-chips-secondary .ohne-chips-item {
    --ohne-background: var(--ohne-secondary);
    --ohne-foreground: var(--ohne-secondary-foreground);
  }

  .ohne-chips-accent .ohne-chips-item,
  .ohne-chips-primary.ohne-chips-dragging .ohne-chips-item:not(.ohne-chips-item-dragging) {
    --ohne-background: var(--ohne-accent);
    --ohne-foreground: var(--ohne-accent-foreground);
  }

  .ohne-chips .ohne-chips-item-destructive {
    --ohne-background: var(--ohne-destructive);
    --ohne-foreground: var(--ohne-destructive-foreground);
  }

  .ohne-chips-disabled .ohne-chips-item,
  .ohne-chips .ohne-chips-item-dragging {
    --ohne-background: var(--ohne-muted);
    --ohne-foreground: var(--ohne-muted-foreground);
  }

  .ohne-chips-label {
    margin-top: -0.0625em;
    overflow: hidden;
    white-space: pre;
    text-overflow: ellipsis;
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
  }

  .ohne-chips-remove {
    flex-shrink: 0;
    border-radius: 50%;
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-chips-remove:disabled {
    pointer-events: none;
  }

  .ohne-chips-remove:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-destructive-foreground)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-chips-dropzone {
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

  .ohne-chips-dropzone::before {
    content: '';
    flex-shrink: 0;
    width: 0.125rem;
    height: 100%;
    background-color: hsl(var(--ohne-foreground));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-chips-dropzone:hover,
  .ohne-chips-dragging-touch .ohne-chips-dropzone {
    opacity: 1;
  }

  .ohne-chips-input {
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

  .ohne-chips-input::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-chips-dropdown {
    width: var(--ohne-width);
  }

  .ohne-chips-dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 2em;
    padding: 0 0.5em;
    border: none;
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    color: hsl(var(--ohne-foreground));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-decoration: none;
  }

  .ohne-chips-dropdown-item-highlighted {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-chips-dropdown-no-results {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 2em;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-chips-dropdown-no-results span {
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-chips-dropdown .ohne-dropdown-scrollable {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }
`;

/**
 * A tag input: free text, or choice-restricted with a filtering dropdown when `choices` is given.
 * Chips reorder by mouse drag or touch long-press.
 * Backspace deletes in two steps: the first press previews the last chip destructively, the second removes.
 * In select mode the dropdown filters by keywords and carries the focus ring on the field's behalf.
 * It locks the window and `scrollContainer` scroll while open; a window resize closes it.
 * A trailing hidden input carries `id` and `name` for label linkage and form serialization.
 *
 * @example
 * ```ts
 * const tags = ref<string[]>([])
 * chips(tags, { placeholder: 'Add a tag' })
 * ```
 */
export function chips(model: Ref<string[]>, options: ChipsOptions = {}): HTMLElement {
  const choicesOf = options.choices;
  const isFocused = ref(false);
  const isDropdownVisible = ref(false);
  const inputValue = ref('');
  const filteredChoices = ref<ChipsChoice[]>([]);
  const highlightedIndex = ref(0);
  const erroredItemsMap = ref<Record<number, boolean>>({});
  const backspaceIndex = ref<number | null>(null);
  const removeIndex = ref<number | null>(null);
  const draggingIndex = ref<number | null>(null);
  const isTouchDragging = ref(false);
  const pointerEvents = ref(true);
  const dragStops: (() => void)[] = [];

  let root: HTMLElement | null = null;
  let dropdownHandle: DropdownHandle | null = null;
  let touchTimeout: ReturnType<typeof setTimeout> | undefined;
  let releaseOpen: (() => void) | null = null;

  const labels = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (choicesOf)
      for (const choice of choicesOf()) map[choice.value] = choice.label ?? choice.value;
    return map;
  });

  const tooltips = computed<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {};
    if (choicesOf) for (const choice of choicesOf()) map[choice.value] = choice.tooltip;
    return map;
  });

  const displayLabel = (value: string): string => labels.value[value] || value;

  const filterChoices = (): void => {
    if (!choicesOf) return;
    const pool = choicesOf();
    filteredChoices.value = searchByKeywords(
      (options.enforceUniqueItems ?? true)
        ? pool.filter(({ value }) => !model.value.includes(value))
        : pool,
      inputValue.value,
      ['label', 'value'],
    );
    highlightedIndex.value = Math.min(
      filteredChoices.value.length - 1,
      highlightedIndex.value > -1 ? highlightedIndex.value : 0,
    );
    dropdownHandle?.update();
  };

  const processInputValue = (): void => {
    const value =
      (options.trim ?? true) ? inputValue.value.trim().replace(/\s+/g, ' ') : inputValue.value;
    const maxItems = options.maxItems ?? false;

    if (choicesOf) {
      const highlighted = filteredChoices.value[highlightedIndex.value]?.value;
      if (highlighted !== undefined) {
        // The check compares the typed text; `filterChoices` already excludes selected values.
        if ((options.enforceUniqueItems ?? true) && model.value.includes(value)) {
          inputValue.value = '';
        } else if (maxItems === false || model.value.length < maxItems) {
          model.value = [...model.value, highlighted];
          filterChoices();
        }
      }
    } else {
      if ((options.enforceUniqueItems ?? true) && model.value.includes(value)) {
        inputValue.value = '';
      } else if (maxItems === false || model.value.length < maxItems) {
        model.value = [...model.value, value];
        inputValue.value = '';
      }
    }

    input.select();
  };

  const focusPreviousChoice = (): void => {
    if (!choicesOf) return;
    highlightedIndex.value = Math.max(0, highlightedIndex.value - 1);
    scrollToHighlightedChoice();
  };

  const focusNextChoice = (): void => {
    if (!choicesOf) return;
    highlightedIndex.value = Math.min(filteredChoices.value.length - 1, highlightedIndex.value + 1);
    scrollToHighlightedChoice();
  };

  const scrollToHighlightedChoice = (): void => {
    const handle = dropdownHandle;
    if (highlightedIndex.value > -1 && handle) {
      const { itemHeight, em } = handle.calcItemSizes();
      const scroll = handle.scrollable;
      let top = itemHeight * highlightedIndex.value;
      if (top > 0 && (!scroll.arrivedTop.value || !scroll.arrivedBottom.value)) top -= em;
      // The programmatic scroll fires a synthetic mousemove that would steal the highlight.
      pointerEvents.value = false;
      scroll.y.value = top;
      setTimeout(() => {
        pointerEvents.value = true;
      });
    }
  };

  const handleDrag = (itemIndex: number, event: MouseEvent): void => {
    if (event.button > 0 || options.disabled?.()) return;

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
    if (!options.disabled?.()) {
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
      const items: (string | null)[] = [...model.value];
      const dragged = items.splice(from, 1, null)[0] ?? null;
      items.splice(index, 0, dragged);
      model.value = items.filter((item): item is string => item !== null);
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
      return (
        (options.disabled?.() ?? false) || (maxItems !== false && model.value.length >= maxItems)
      );
    },
    id: options.id ? `${options.id}--input` : undefined,
    name: options.name ? `${options.name}--input` : undefined,
    placeholder: options.placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
    class: 'ohne-chips-input',
    onFocus: () => {
      isFocused.value = true;
      isDropdownVisible.value = true;
      highlightedIndex.value = 0;
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
            filterChoices();
          } else {
            backspaceIndex.value = model.value.length ? model.value.length - 1 : null;
            removeIndex.value = backspaceIndex.value;
          }
        }
      } else if (event.key === 'Enter') {
        processInputValue();
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
      class: 'ohne-chips-dropzone',
      onMouseup: () => drop(target()),
      onTouchstart: () => drop(target()),
    });

  const openDropdown = (): HTMLElement => {
    const handle = dropdown(
      [
        each(
          () => filteredChoices.value,
          (choice) => choice.value,
          (choice, index) =>
            h(
              'button',
              {
                title: () => choice().label || choice().value,
                class: () =>
                  'ohne-chips-dropdown-item ohne-raw' +
                  (highlightedIndex.value === index()
                    ? ' ohne-chips-dropdown-item-highlighted'
                    : ''),
                onClick: (event: MouseEvent) => event.preventDefault(),
                // Mousedown, so the text input never loses focus.
                onMousedown: (event: MouseEvent) => {
                  event.preventDefault();
                  model.value = [...model.value, choice().value];
                  filterChoices();
                },
                onMouseenter: () => {
                  if (pointerEvents.value) highlightedIndex.value = index();
                },
                onMousemove: () => {
                  if (pointerEvents.value) highlightedIndex.value = index();
                },
              },
              () => choice().label || choice().value,
            ),
        ),
        when(
          () => filteredChoices.value.length === 0,
          () =>
            h(
              'span',
              { class: 'ohne-chips-dropdown-no-results' },
              h('span', null, options.noResultsLabel ?? 'No results found'),
            ),
        ),
      ],
      {
        reference: root ?? undefined,
        offset: 7,
        handleControls: false,
        restoreFocus: false,
        inheritColors: true,
        class: 'ohne-chips-dropdown',
        onClose: () => {
          isDropdownVisible.value = false;
        },
      },
    );

    dropdownHandle = handle;
    onCleanup(() => {
      dropdownHandle = null;
    });

    return handle.root;
  };

  root = h(
    'div',
    {
      class: () =>
        'ohne-chips' +
        (options.error?.() ? ' ohne-chips-has-errors' : '') +
        (options.disabled?.() ? ' ohne-chips-disabled' : '') +
        (isFocused.value ? ' ohne-chips-focused' : '') +
        (isDropdownVisible.value && choicesOf ? ' ohne-chips-dropdown-visible' : '') +
        (model.value.length === 0 ? ' ohne-chips-empty' : '') +
        (draggingIndex.value !== null ? ' ohne-chips-dragging' : '') +
        (draggingIndex.value !== null && isTouchDragging.value
          ? ' ohne-chips-dragging-touch'
          : '') +
        ` ohne-chips-${options.variant ?? 'accent'}`,
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
      { class: 'ohne-chips-list' },
      each(
        () => model.value,
        (_, index) => index,
        (item, index) => {
          const label = h(
            'span',
            { class: 'ohne-chips-label', title: () => displayLabel(item()) },
            () => displayLabel(item()),
          );
          if (choicesOf) onCleanup(attachTooltip(label, () => tooltips.value[item()] ?? null));
          return [
            when(
              () => draggingIndex.value !== null,
              () => dropzone(() => index()),
            ),
            h(
              'li',
              {
                class: () =>
                  'ohne-chips-item' +
                  (draggingIndex.value === index() ? ' ohne-chips-item-dragging' : '') +
                  (erroredItemsMap.value[index()] || removeIndex.value === index()
                    ? ' ohne-chips-item-destructive'
                    : ''),
                onMousedown: (event: MouseEvent) => handleDrag(index(), event),
                onTouchstart: (event: TouchEvent) => {
                  event.preventDefault();
                  onTouchStart(index());
                },
              },
              label,
              when(
                () => !options.disabled?.(),
                () =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'ohne-chips-remove ohne-raw',
                      disabled: () => draggingIndex.value !== null,
                      title: options.removeItemLabel ?? 'Remove',
                      onClick: () => {
                        const at = index();
                        model.value = model.value.filter((_, i) => i !== at);
                        filterChoices();
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
          ];
        },
      ),
      input,
    ),
    when(
      () => isDropdownVisible.value && choicesOf !== undefined,
      () => openDropdown(),
    ),
    h('input', {
      id: options.id,
      name: options.name,
      value: () => String(model.value),
      hidden: true,
    }),
  );

  effect(() => {
    void model.value;
    erroredItemsMap.value = {};
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
    untracked(filterChoices);
  });

  effect(() => {
    if (isDropdownVisible.value && choicesOf) {
      const unlockWindow = lockScroll(document.documentElement);
      const pane = options.scrollContainer ?? nearestContainer(input);
      const unlockContainer = pane ? lockScroll(pane) : null;
      const onOutsideClick = (event: MouseEvent): void => {
        if (event.target instanceof Node && root && !root.contains(event.target)) input.blur();
      };
      const onResize = (): void => input.blur();
      document.addEventListener('click', onOutsideClick);
      window.addEventListener('resize', onResize);
      releaseOpen = () => {
        document.removeEventListener('click', onOutsideClick);
        window.removeEventListener('resize', onResize);
        unlockWindow();
        unlockContainer?.();
      };
    } else {
      releaseOpen?.();
      releaseOpen = null;
    }
  });

  const onTouchEnd = (): void => clearTimeout(touchTimeout);
  document.addEventListener('touchend', onTouchEnd);

  onCleanup(() => {
    document.body.style.removeProperty('cursor');
    clearTimeout(touchTimeout);
    document.removeEventListener('touchend', onTouchEnd);
    for (const stop of dragStops) stop();
    dragStops.length = 0;
    releaseOpen?.();
    releaseOpen = null;
  });

  return root;
}

function lockScroll(element: HTMLElement): () => void {
  const previous = element.style.overflow;
  element.style.overflow = 'hidden';
  return () => {
    if (previous) element.style.overflow = previous;
    else element.style.removeProperty('overflow');
  };
}
