import { paletteQuery, paletteView } from 'app/components/palette-state.ts';
import { button, type Child, css, dropdown, dropdownItem, h, icon, when } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

import { useAIT } from './_ai-messages.ts';
import { aiMeta } from './_ai-meta.ts';
import { currentModel, setPickedModel } from './_ai-model-pick.ts';
import { clearTurns, turns, turnSettled } from './turn-store.ts';

const SEARCH_INPUT = '.o-palette .o-search-input input';

css`
  .o-ai-new-question {
    margin-right: auto;
  }

  .o-ai-model-menu-check {
    margin-left: auto;
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * The palette footer's "New question" button, shown while a settled conversation fills the palette.
 * It clears the conversation and returns to search, where the next question starts fresh.
 */
export function aiNewQuestion(): Child {
  return when(
    () => paletteView.value === 'turn' && turns.value.length > 0 && turnSettled(),
    () => {
      const t = useAIT();
      const trigger = button([icon('plus'), h('span', null, () => t('ai.dashboard.newQuestion'))], {
        variant: 'ghost',
        size: -2,
        onClick: () => {
          clearTurns();
          paletteQuery.value = '';
          paletteView.value = 'search';
          document.querySelector<HTMLInputElement>(SEARCH_INPUT)?.focus();
        },
      });
      trigger.classList.add('o-ai-new-question');
      return trigger;
    },
  );
}

/**
 * The palette footer's model menu: a small button naming the model the next question plans with.
 * It shows only when the person may pick among several models; the pick is remembered in this browser.
 * Closing the menu hands focus back to the palette's search input.
 */
export function aiModelMenu(): Child {
  return when(
    () => (aiMeta()?.models.length ?? 0) > 1,
    () => {
      const t = useAIT();
      const open = ref(false);
      const trigger = button(
        [icon('sparkles'), h('span', null, () => currentModel() ?? ''), icon('chevron-down')],
        {
          variant: 'ghost',
          size: -2,
          onClick: () => {
            open.value = !open.value;
          },
        },
      );
      trigger.title = t('ai.dashboard.model');
      const pick = (name: string): void => {
        setPickedModel(name === aiMeta()?.model ? null : name);
        open.value = false;
      };
      return h(
        'div',
        null,
        trigger,
        when(
          () => open.value,
          () =>
            dropdown(
              (aiMeta()?.models ?? []).map((name) =>
                dropdownItem([h('span', null, name), name === currentModel() ? check() : null], {
                  onClick: () => pick(name),
                }),
              ),
              {
                reference: trigger,
                placement: 'end',
                restoreFocus: SEARCH_INPUT,
                size: -1,
                onClose: () => {
                  open.value = false;
                },
              },
            ).root,
        ),
      );
    },
  );
}

/**
 * The check that marks the model in use.
 */
function check(): SVGSVGElement {
  const svg = icon('check');
  svg.classList.add('o-ai-model-menu-check');
  return svg;
}
