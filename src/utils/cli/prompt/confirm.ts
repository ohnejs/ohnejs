import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptDefinition } from './_prompt.ts';

import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { leadIn, titleLine } from './_frame.ts';

/**
 * Options for a confirm prompt.
 */
export interface ConfirmOptions {
  /**
   * The yes/no question shown above the choice.
   */
  message: string;

  /**
   * Which side starts selected: `true` highlights the affirmative.
   *
   * @default
   * true
   */
  initialValue?: boolean;

  /**
   * Label for the affirmative choice.
   *
   * @default
   * 'Yes'
   */
  active?: string;

  /**
   * Label for the negative choice.
   *
   * @default
   * 'No'
   */
  inactive?: string;
}

/**
 * Builds the definition for a yes/no prompt resolving to a boolean.
 * Arrows or `tab` flip the selection; `y` and `n` pick a side and submit at once.
 * `enter` takes the current side.
 */
export function confirmDefinition(options: ConfirmOptions): PromptDefinition<boolean> {
  const activeLabel = options.active ?? 'Yes';
  const inactiveLabel = options.inactive ?? 'No';
  let current: { value: boolean; status: 'active' | 'submit' | 'cancel' };

  const choose = (value: boolean): void => void (current.value = value);
  const submit = (value: boolean): void => {
    current.value = value;
    current.status = 'submit';
  };

  const keymap = createKeymap({
    enter: () => submit(current.value),
    y: () => submit(true),
    n: () => submit(false),
    arrowleft: () => choose(true),
    arrowright: () => choose(false),
    arrowup: () => choose(!current.value),
    arrowdown: () => choose(!current.value),
    tab: () => choose(!current.value),
  });

  return {
    initialValue: options.initialValue ?? true,

    render(state, { colors, lead }) {
      const rail = colors.dim('│');
      const label = state.value ? activeLabel : inactiveLabel;
      const value =
        state.status === 'active'
          ? `${radio(state.value, activeLabel, colors)} ${colors.dim('/')} ${radio(!state.value, inactiveLabel, colors)}`
          : colors.dim(label);

      const valueLine = `${rail}  ${value}`;
      const body = state.status === 'active' ? `${rail}\n${valueLine}\n${rail}` : valueLine;
      const block = `${titleLine(options.message, state.status, undefined, colors)}\n${body}`;
      return leadIn(block, lead, colors);
    },

    onKey(key, str, state) {
      current = state;
      keymap(strokeFromReadlineKey(str, key));
    },
  };
}

function radio(selected: boolean, label: string, colors: ANSIColors): string {
  return selected ? `${colors.cyan('●')} ${label}` : colors.dim(`○ ${label}`);
}
