import { sessionUser, useHotkeys } from 'ohnejs/dashboard';
import { computed, effect, untracked } from 'ohnejs/utils';

import { openPalette, resetPalette } from '../components/palette-state.ts';
import { palette } from '../components/palette.ts';
import { registerShellSlot } from '../components/shell-slots.ts';

registerShellSlot('global', () => {
  const { listen } = useHotkeys({ allowWhileTyping: ['search'] });
  listen('search', (event) => {
    event.preventDefault();
    openPalette();
  });
  return palette();
});

// A sign-out keeps the page, so the next person must never see the last one's search.
const person = computed(() => sessionUser()?.UUID ?? null);
effect(() => {
  void person.value;
  untracked(resetPalette);
});
