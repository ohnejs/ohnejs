import {
  paletteGroups,
  paletteHits,
  paletteQuery,
  paletteView,
} from 'app/components/palette-state.ts';
import {
  type Child,
  dashboardMeta,
  h,
  hasModifierKey,
  type VerticalMenuItemModel,
  verticalMenu,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  effect,
  isUndefined,
  onCleanup,
  ref,
  searchByKeywords,
  untracked,
} from 'ohnejs/utils';

import type { AISkillMeta } from './_ai-meta.ts';

import { useAIT } from './_ai-messages.ts';
import { aiMeta } from './_ai-meta.ts';
import { ask } from './assistant.ts';
import { turnSettled } from './turn-store.ts';

const WHITESPACE = /\s+/;

/**
 * The palette's last row while the person has an assistant.
 * It reads "Ask: <query>", or "Assistant" on a blank query, and opens the turn view.
 * A query starting with `/` lists the skills matching the word after it.
 * Picking one starts a turn with that skill.
 * The words after the skill's name are the question; without any, the skill's title stands in.
 * Enter asks when the palette has no row to open; a modified Enter always asks.
 * While a turn still runs, the row only opens the turn view, and the query stays.
 * With skills listed, ArrowUp and ArrowDown move among them and Enter starts the marked one.
 */
export function askRow(): Child {
  return when(() => !isUndefined(aiMeta()), row);
}

/**
 * The row proper, rendered while the assistant is on.
 */
function row(): Child {
  const t = useAIT();
  const query = computed(() => paletteQuery.value.trim());
  const skillQuery = computed(() => (query.value.startsWith('/') ? query.value.slice(1) : null));
  const skills = computed<AISkillMeta[]>(() => {
    const typed = skillQuery.value;
    if (typed === null) return [];
    const [name] = typed.split(WHITESPACE);
    const all = aiMeta()?.skills ?? [];
    return name === '' ? [...all] : searchByKeywords(all, name, ['name', 'title']);
  });
  const active = ref(0);
  effect(() => {
    void skills.value;
    untracked(() => (active.value = 0));
  });

  const start = (input: string, skill?: string): void => {
    paletteQuery.value = '';
    paletteView.value = 'turn';
    void ask(input, skill);
  };
  const startSkill = (skill: AISkillMeta): void => {
    const rest = (untracked(() => skillQuery.value) ?? '').split(WHITESPACE).slice(1).join(' ');
    start(rest === '' ? skill.title : rest, skill.name);
  };
  const submit = (): void => {
    const input = untracked(() => query.value);
    if (input === '' || !untracked(turnSettled)) paletteView.value = 'turn';
    else start(input);
  };
  const hasRows = (): boolean => {
    const meta = dashboardMeta();
    const groups = paletteGroups(
      paletteQuery.value,
      paletteHits.value,
      meta?.collections ?? [],
      meta?.menu ?? [],
    );
    return groups.some((group) => group.entries.length > 0);
  };

  // Capture phase on the document: the palette's own Enter handler sits on its input and must not run.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest('.o-palette-search') === null) {
      return;
    }
    if (untracked(() => paletteView.value) !== 'search') return;
    const listed = untracked(() => skills.value);
    if (untracked(() => skillQuery.value) !== null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const count = listed.length;
        if (count === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active.value = (((untracked(() => active.value) + step) % count) + count) % count;
      } else if (event.key === 'Enter') {
        const skill = listed[untracked(() => active.value)];
        if (isUndefined(skill)) return;
        event.preventDefault();
        event.stopPropagation();
        startSkill(skill);
      }
      return;
    }
    if (event.key === 'Enter' && (hasModifierKey(event) || !untracked(hasRows))) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  onCleanup(() => document.removeEventListener('keydown', onKeydown, true));

  const askItem = (): VerticalMenuItemModel[] => [
    {
      label:
        query.value === ''
          ? t('ai.dashboard.assistant')
          : t('ai.dashboard.ask', { query: query.value }).replaceAll('`', ''),
      icon: 'sparkles',
      action: submit,
    },
  ];
  const skillItems = (): VerticalMenuItemModel[] =>
    skills.value.map((skill, index) => ({
      label: skill.title,
      icon: 'sparkles',
      active: index === active.value,
      action: () => startSkill(skill),
    }));

  return [
    when(
      () => skillQuery.value === null,
      () => verticalMenu({ items: askItem }),
    ),
    when(
      () => skillQuery.value !== null && skills.value.length > 0,
      () => verticalMenu({ title: t('ai.dashboard.skills'), items: skillItems }),
    ),
    when(
      () => skillQuery.value !== null && skills.value.length === 0,
      () =>
        h('div', { class: 'o-palette-empty', role: 'status' }, () => t('ai.dashboard.noSkills')),
    ),
  ];
}
