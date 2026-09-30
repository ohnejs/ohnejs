import { registerPaletteSlot } from 'app/components/palette-slots.ts';
import { registerShellSlot } from 'app/components/shell-slots.ts';

import { aiModelMenu, aiNewQuestion } from '../components/_ai-palette-footer.ts';
import { assistantRows } from '../components/assistant-rows.ts';
import { sendingPill } from '../components/sending-pill.ts';
import { turnView } from '../components/turn-view.ts';

registerPaletteSlot('row', assistantRows);
registerPaletteSlot('view', turnView);
registerPaletteSlot('footer', aiNewQuestion);
registerPaletteSlot('footer', aiModelMenu);
registerShellSlot('global', sendingPill);
