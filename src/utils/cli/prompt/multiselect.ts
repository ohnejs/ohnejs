import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptDefinition } from './_prompt.ts';
import type { SelectOption } from './option.ts';

import { isUndefined } from '../../is/is-undefined.ts';
import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { leadIn, titleLine } from './_frame.ts';
import { optionLabel, optionListBody } from './option.ts';
import { closingRail } from './validate.ts';

/**
 * Options for a multi-choice select prompt.
 */
export interface MultiselectOptions<T> {
  /**
   * The question shown above the list.
   */
  message: string;

  /**
   * The choices, in display order.
   */
  options: SelectOption<T>[];

  /**
   * Values checked from the start.
   *
   * @default
   * []
   */
  initialValues?: T[];

  /**
   * Whether at least one choice must be checked before the prompt accepts a submit.
   *
   * @default
   * false
   */
  required?: boolean;

  /**
   * Most rows shown at once before the list scrolls to keep the cursor in view.
   * Falls back to showing every option.
   */
  maxItems?: number;
}

/**
 * Builds the definition for a multi-choice list resolving to the checked options' values, in display order.
 * `up`/`down` (or `k`/`j`) move the cursor and wrap; `space` toggles the row; `a` toggles all.
 * `enter` submits the checked options.
 * With `required` set, an empty submit is rejected with an inline error instead of resolving.
 */
export function multiselectDefinition<T>(options: MultiselectOptions<T>): PromptDefinition<T[]> {
  const items = options.options;
  const count = items.length;
  const max = options.maxItems ?? count;
  const selected = new Set<number>();
  items.forEach((option, i) => {
    if (options.initialValues?.includes(option.value)) selected.add(i);
  });
  let cursor = 0;
  let error: string | undefined;
  let current: { value: T[]; status: 'active' | 'submit' | 'cancel' };

  const sync = (): void => {
    current.value = items.filter((_, i) => selected.has(i)).map((option) => option.value);
  };
  const move = (delta: number): void => void (cursor = (cursor + delta + count) % count);
  const toggle = (): void => {
    if (selected.has(cursor)) selected.delete(cursor);
    else selected.add(cursor);
    sync();
  };
  const toggleAll = (): void => {
    if (selected.size === count) selected.clear();
    else for (let i = 0; i < count; i += 1) selected.add(i);
    sync();
  };
  const submit = (): void => {
    if (options.required && selected.size === 0) {
      error = 'Select at least one option.';
      return;
    }
    current.status = 'submit';
  };

  const keymap = createKeymap({
    arrowup: () => move(-1),
    k: () => move(-1),
    arrowdown: () => move(1),
    j: () => move(1),
    home: () => void (cursor = 0),
    end: () => void (cursor = count - 1),
    space: toggle,
    a: toggleAll,
    enter: submit,
  });

  return {
    initialValue: items.filter((_, i) => selected.has(i)).map((option) => option.value),

    render(state, { colors, lead }) {
      if (state.status !== 'active') {
        const labels = items.filter((_, i) => selected.has(i)).map(optionLabel);
        const summary = labels.length === 0 ? 'none' : labels.join(', ');
        const block = `${titleLine(options.message, state.status, undefined, colors)}\n${colors.dim('│')}  ${colors.dim(summary)}`;
        return leadIn(block, lead, colors);
      }

      const rail = isUndefined(error) ? colors.dim('│') : colors.red('│');
      const rows = optionListBody(
        count,
        cursor,
        max,
        colors,
        (i) => checkbox(items[i], i === cursor, selected.has(i), colors),
        rail,
      );
      const body = `${rail}\n${rows}\n${closingRail(error, colors)}`;
      const block = `${titleLine(options.message, state.status, error, colors)}\n${body}`;
      return leadIn(block, lead, colors);
    },

    onKey(key, str, state) {
      current = state;
      error = undefined;
      keymap(strokeFromReadlineKey(str, key));
    },
  };
}

/**
 * Draws one row: a cyan box and hint when focused, a green box when checked, dimmed otherwise.
 */
function checkbox<T>(
  option: SelectOption<T>,
  focused: boolean,
  checked: boolean,
  colors: ANSIColors,
): string {
  const box = checked ? '◼' : '◻';
  const label = optionLabel(option);
  if (focused) {
    const hint = isUndefined(option.hint) ? '' : ` ${colors.dim(option.hint)}`;
    return `${colors.cyan(box)} ${label}${hint}`;
  }
  if (checked) return `${colors.green(box)} ${label}`;
  return colors.dim(`${box} ${label}`);
}
