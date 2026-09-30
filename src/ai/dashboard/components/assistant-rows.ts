import { paletteQuery, type PaletteRowGroup, paletteView } from 'app/components/palette-state.ts';
import { isUndefined } from 'ohnejs/utils';

import { useAIT } from './_ai-messages.ts';
import { aiMeta } from './_ai-meta.ts';
import { askRows } from './ask-rows.ts';
import { ask } from './assistant.ts';
import { turnSettled } from './turn-store.ts';

/**
 * The assistant's palette rows, read reactively; none while the person has no assistant.
 * Starting a turn empties the query and shows the turn view; only showing it keeps the query.
 */
export function assistantRows(): PaletteRowGroup[] {
  const meta = aiMeta();
  if (isUndefined(meta)) return [];
  return askRows({
    query: paletteQuery.value.trim(),
    skills: meta.skills,
    flows: meta.flows,
    settled: turnSettled(),
    t: useAIT(),
    start: (input, starter) => {
      paletteQuery.value = '';
      paletteView.value = 'turn';
      void ask(input, isUndefined(starter) ? {} : { [starter.kind]: starter.name });
    },
    view: () => {
      paletteView.value = 'turn';
    },
  });
}
