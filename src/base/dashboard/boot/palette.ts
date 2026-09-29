import { useHotkeys } from 'ohnejs/dashboard';

import { openPalette } from '../components/palette-state.ts';
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
