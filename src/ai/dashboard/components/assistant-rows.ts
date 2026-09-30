import type { PaletteTab } from 'app/components/palette-slots.ts';

import {
  isPaletteCommand,
  paletteQuery,
  type PaletteRowGroup,
  paletteView,
} from 'app/components/palette-state.ts';
import { css } from 'ohnejs/dashboard';
import { isUndefined } from 'ohnejs/utils';

import { useAIT } from './_ai-messages.ts';
import { aiMeta } from './_ai-meta.ts';
import { askRows } from './ask-rows.ts';
import { ask } from './assistant.ts';
import { openChat, recentChats } from './chat-history.ts';
import { clearTurns, turns, turnSettled } from './turn-store.ts';

css`
  .o-palette-results [data-group='ai:ask'] .ohne-vertical-menu-item-button {
    color: hsl(var(--ohne-foreground));
  }
`;

/**
 * The assistant's palette rows, read reactively; none while the person has no assistant.
 * Starting a turn or reopening a chat empties the query and shows the turn view.
 * Only showing it keeps the query.
 */
export function assistantRows(): PaletteRowGroup[] {
  const meta = aiMeta();
  if (isUndefined(meta)) return [];
  return askRows({
    query: paletteQuery.value.trim(),
    skills: meta.skills,
    flows: meta.flows,
    recent: recentChats.value,
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
    fresh: () => {
      clearTurns();
      paletteView.value = 'turn';
    },
    resume: (id) => {
      paletteQuery.value = '';
      paletteView.value = 'turn';
      void openChat(id);
    },
  });
}

/**
 * The palette's placeholder while the person has the assistant, `null` without it.
 * Over a conversation it asks for a follow-up; otherwise it names `/` when there is a skill or flow to start.
 */
export function assistantPlaceholder(): string | null {
  const meta = aiMeta();
  if (isUndefined(meta)) return null;
  const t = useAIT();
  if (paletteView.value === 'turn' && turns.value.length > 0) {
    return t('ai.dashboard.placeholderFollowUp');
  }
  const starters = meta.skills.length > 0 || meta.flows.length > 0;
  return t(starters ? 'ai.dashboard.placeholderStarters' : 'ai.dashboard.placeholder');
}

/**
 * The assistant's offer for the first screen's Tab: ask the typed words as a new question.
 * A command, a running turn, or no assistant makes no offer.
 */
export function assistantTab(query: string): PaletteTab | null {
  if (isUndefined(aiMeta()) || isPaletteCommand(query) || !turnSettled()) return null;
  return {
    label: useAIT()('ai.dashboard.askAssistant'),
    take: () => {
      paletteQuery.value = '';
      paletteView.value = 'turn';
      void ask(query);
    },
  };
}
