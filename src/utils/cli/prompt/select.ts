import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptDefinition } from './_prompt.ts';
import type { SelectOption } from './option.ts';

import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { leadIn, titleLine } from './_frame.ts';
import { optionLabel, optionListBody } from './option.ts';

/**
 * Options for a single-choice select prompt.
 */
export interface SelectOptions<T> {
  /**
   * The question shown above the list.
   */
  message: string;

  /**
   * The choices, in display order.
   */
  options: SelectOption<T>[];

  /**
   * Value of the entry highlighted first.
   * Falls back to the first option.
   */
  initialValue?: T;

  /**
   * Most rows shown at once before the list scrolls to keep the cursor in view.
   * Falls back to showing every option.
   */
  maxItems?: number;
}

/**
 * Builds the definition for a single-choice list resolving to the chosen option's value.
 * `up`/`down` (or `k`/`j`) move the highlight and wrap at the ends; `home`/`end` jump to the bounds.
 * `enter` submits the highlighted option.
 * A list longer than `maxItems` scrolls, keeping the highlighted row visible.
 */
export function selectDefinition<T>(options: SelectOptions<T>): PromptDefinition<T> {
  const items = options.options;
  const count = items.length;
  const max = options.maxItems ?? count;
  const initial = items.findIndex((option) => option.value === options.initialValue);
  let cursor = initial < 0 ? 0 : initial;
  let current: { value: T; status: 'active' | 'submit' | 'cancel' };

  const move = (delta: number): void => {
    cursor = (cursor + delta + count) % count;
    current.value = items[cursor].value;
  };
  const jump = (to: number): void => {
    cursor = to;
    current.value = items[cursor].value;
  };

  const keymap = createKeymap({
    arrowup: () => move(-1),
    k: () => move(-1),
    arrowdown: () => move(1),
    j: () => move(1),
    home: () => jump(0),
    end: () => jump(count - 1),
    enter: () => void (current.status = 'submit'),
  });

  return {
    initialValue: items[cursor]?.value,

    render(state, { colors, lead }) {
      const rail = colors.dim('│');
      const body =
        state.status === 'active'
          ? `${rail}\n${optionListBody(count, cursor, max, colors, (i) => row(items[i], i === cursor, colors))}\n${rail}`
          : `${rail}  ${colors.dim(optionLabel(items[cursor]))}`;
      const block = `${titleLine(options.message, state.status, undefined, colors)}\n${body}`;
      return leadIn(block, lead, colors);
    },

    onKey(key, str, state) {
      current = state;
      keymap(strokeFromReadlineKey(str, key));
    },
  };
}

function row<T>(option: SelectOption<T>, active: boolean, colors: ANSIColors): string {
  const label = optionLabel(option);
  if (!active) return colors.dim(`○ ${label}`);
  const hint = option.hint ? ` ${colors.dim(option.hint)}` : '';
  return `${colors.cyan('●')} ${label}${hint}`;
}
