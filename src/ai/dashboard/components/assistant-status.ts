import { openPalette, paletteView } from 'app/components/palette-state.ts';
import { bubble, button, type Child, when } from 'ohnejs/dashboard';
import { effect, isNull } from 'ohnejs/utils';

import { useAIT } from './_ai-messages.ts';
import { currentTurn, sending } from './turn-store.ts';

/**
 * The header button that keeps the assistant in sight while a turn works, sends, or waits for the person.
 * A bubble counts the requests left to send, and the button turns primary while a batch waits for approval.
 * A click reopens the palette on the turn.
 * Rendered in the shell's `status` slot, so it survives navigation and never shifts the header.
 */
export function assistantStatus(): Child {
  return when(busy, () => {
    const t = useAIT();
    const waiting = (): boolean => currentTurn()?.status === 'waiting';
    const label = (): string => {
      const progress = sending.value;
      if (!isNull(progress)) {
        return t('ai.dashboard.sending', { sent: progress.sent, total: progress.total });
      }
      return t(waiting() ? 'ai.dashboard.approval' : 'ai.dashboard.working');
    };
    const trigger = button(label, {
      icon: 'sparkles',
      iconOnly: true,
      variant: 'outline',
      bubble: when(
        () => !isNull(sending.value),
        () => bubble(() => (sending.value?.total ?? 0) - (sending.value?.sent ?? 0)),
      ),
      onClick: () => {
        openPalette();
        paletteView.value = 'turn';
      },
    });
    effect(() => {
      trigger.classList.toggle('ohne-button-primary', waiting());
      trigger.classList.toggle('ohne-button-outline', !waiting());
    });
    return trigger;
  });
}

/**
 * Whether the live turn streams, sends, or waits for the person.
 */
function busy(): boolean {
  const status = currentTurn()?.status;
  return status === 'streaming' || status === 'sending' || status === 'waiting';
}
