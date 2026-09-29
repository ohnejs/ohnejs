import { registerPaletteSlot } from 'app/components/palette-slots.ts';
import { registerShellSlot } from 'app/components/shell-slots.ts';

import { askRow } from '../components/ask-row.ts';
import { sendingPill } from '../components/sending-pill.ts';
import { turnView } from '../components/turn-view.ts';

registerPaletteSlot('row', askRow);
registerPaletteSlot('view', turnView);
registerShellSlot('global', sendingPill);
