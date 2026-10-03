import { registerPaletteSlot } from 'app/components/palette-slots.ts';
import { paletteOpen } from 'app/components/palette-state.ts';
import { registerShellSlot } from 'app/components/shell-slots.ts';
import { sessionUser } from 'ohnejs/dashboard';
import { clamp, computed, effect, isUndefined, untracked } from 'ohnejs/utils';

import { aiMeta } from '../components/_ai-meta.ts';
import { aiModelMenu, aiNewQuestion } from '../components/_ai-palette-footer.ts';
import { assistantPlaceholder, assistantRows, assistantTab } from '../components/assistant-rows.ts';
import { assistantStatus } from '../components/assistant-status.ts';
import { loadRecentChats, recentChats, waitingUntil } from '../components/chat-history.ts';
import { clearTurns, markTurn, pendingBatch, turnSettled } from '../components/turn-store.ts';
import { turnView } from '../components/turn-view.ts';

/**
 * The longest delay `setTimeout` keeps; a later deadline is checked on the way.
 */
const MAX_DELAY = 2_147_483_647;

registerPaletteSlot('row', assistantRows);
registerPaletteSlot('view', turnView);
registerPaletteSlot('footer', aiNewQuestion);
registerPaletteSlot('footer', aiModelMenu);
registerPaletteSlot('placeholder', assistantPlaceholder);
registerPaletteSlot('tab', assistantTab);
registerShellSlot('status', assistantStatus);

// A sign-out keeps the page, so the next person must never see the last one's chats.
const person = computed(() => sessionUser()?.UUID ?? null);
effect(() => {
  void person.value;
  untracked(() => {
    recentChats.value = [];
    clearTurns();
  });
});

// The server closes a batch left waiting past `turnTimeout`; asking it then keeps the button from sticking.
let idle: ReturnType<typeof setTimeout> | undefined;
const watchIdle = (id: string, deadline: number, timeout: number): void => {
  clearTimeout(idle);
  idle = setTimeout(
    () =>
      void waitingUntil(id, timeout).then((until) => {
        if (untracked(pendingBatch)?.id !== id) return;
        if (isUndefined(until)) markTurn('closed', 'idle');
        else watchIdle(id, until, timeout);
      }),
    clamp(deadline - Date.now(), 0, MAX_DELAY),
  );
};
effect(() => {
  clearTimeout(idle);
  const batch = pendingBatch();
  const timeout = aiMeta()?.turnTimeout;
  if (isUndefined(batch) || isUndefined(timeout)) return;
  watchIdle(batch.id, (batch.since ?? Date.now()) + timeout, timeout);
});

const settled = computed(turnSettled);
effect(() => {
  if (paletteOpen.value && settled.value && !isUndefined(aiMeta())) void loadRecentChats();
});
