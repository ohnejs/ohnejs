import { openPalette, paletteOpen, paletteView } from 'app/components/palette-state.ts';
import { type Child, css, h, icon, when } from 'ohnejs/dashboard';

import { useAIT } from './_ai-messages.ts';
import { currentTurn, sending } from './turn-store.ts';

css`
  .o-assistant-pill {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    height: 2rem;
    padding: 0 0.75rem;
    background-color: hsl(var(--ohne-primary));
    border-radius: 1rem;
    box-shadow: var(--ohne-shadow);
    color: hsl(var(--ohne-primary-foreground));
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .o-assistant-pill > svg {
    font-size: 1rem;
  }
`;

/**
 * The pill that keeps the assistant in sight while the palette is closed and a turn is still open.
 * It reads "Assistant: sending 12 of 38" while a batch goes out.
 * While a step streams it reads "Assistant: working".
 * While a batch waits for the person it says so, so leaving the palette never loses the batch.
 * A click reopens the palette on the turn.
 * Rendered in the shell's `global` slot, so it survives navigation.
 */
export function sendingPill(): Child {
  return when(
    () => busy() && !paletteOpen.value,
    () => {
      const t = useAIT();
      return h(
        'button',
        {
          type: 'button',
          class: 'o-assistant-pill ohne-raw',
          onClick: () => {
            openPalette();
            paletteView.value = 'turn';
          },
        },
        icon('sparkles'),
        h('span', null, () => {
          const progress = sending.value;
          if (progress !== null) {
            return t('ai.dashboard.sending', { sent: progress.sent, total: progress.total });
          }
          return t(
            currentTurn()?.status === 'waiting' ? 'ai.dashboard.approval' : 'ai.dashboard.working',
          );
        }),
      );
    },
  );
}

/**
 * Whether the live turn streams, sends, or waits for the person.
 */
function busy(): boolean {
  const status = currentTurn()?.status;
  return status === 'streaming' || status === 'sending' || status === 'waiting';
}
