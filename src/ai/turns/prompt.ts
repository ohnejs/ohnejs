import type { User } from 'ohnejs/auth';

import { formatDatePattern, isEmpty } from 'ohnejs/utils';

import type { PromptBlock } from '../providers/provider.ts';

import { defaultLanguage } from '../../ohne/http/translate.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { useAIConfig } from '../config.ts';

/**
 * What the turn context block names about the person and the turn.
 */
export interface TurnContext {
  /**
   * The person asking, whose language, content locale and time zone the model reads.
   */
  user: User;

  /**
   * The dashboard route pattern the person asked from.
   */
  page: string;
}

const SKILL_TAG = /<skill\b/gi;

/**
 * Builds the system prompt of one step: guard, operator, instructions, surface, then the turn context.
 * A prompt the config empties drops out.
 * The last app block and the surface end a cached prefix, so a provider with breakpoints reuses both.
 * The turn context comes last and is never cached, since it changes per turn.
 */
export function buildPrompt(surface: string, context: TurnContext): PromptBlock[] {
  const { prompts, instructions } = useAIConfig();
  const app = [
    prompts.guard,
    prompts.operator,
    isEmpty(instructions) ? '' : ['# Instructions', ...instructions].join('\n'),
  ]
    .filter((text) => text !== '')
    .map((text): PromptBlock => ({ text }));
  const last = app.at(-1);
  if (last) last.cache = true;
  return [
    ...app,
    { text: surface, cache: true },
    { text: contextBlock(context, prompts.reminder) },
  ];
}

/**
 * The text of the person's message: the skill's fence first when one starts the turn, then the input.
 * A `<skill` the person typed is escaped, so nobody forges a skill's authority from the palette.
 */
export function userMessage(input: string, skill?: { name: string; prompt: string }): string {
  const typed = input.replace(SKILL_TAG, '&lt;skill');
  return skill ? `${skillFence(skill.name, skill.prompt)}\n\n${typed}` : typed;
}

/**
 * A skill's instructions as one fence, the shape both the `skill` tool and a `/name` start use.
 *
 * @example
 * ```ts
 * skillFence('translate-items', 'Translate every item.')
 * // -> '<skill name="translate-items">\nTranslate every item.\n</skill>'
 * ```
 */
export function skillFence(name: string, prompt: string): string {
  return `<skill name="${name}">\n${prompt.trim()}\n</skill>`;
}

/**
 * The `# Person` block: language, content locale, date and time zone, the page, and the reminder.
 * The date reads in the person's time zone, or UTC when they set none.
 */
function contextBlock({ user, page }: TurnContext, reminder: string): string {
  const language = user.dashboardLanguage ?? defaultLanguage();
  const locale = user.contentLanguage ?? queryLocales().defaultLocale;
  const timeZone = user.timezone ?? 'UTC';
  const now = Date.now();
  const date = formatDatePattern(now, 'YYYY-MM-DD', { language: 'en', timeZone });
  const offset = formatDatePattern(now, 'Z', { language: 'en', timeZone });
  return [
    '# Person',
    `Language: ${language}. Content locale: ${locale}. Date: ${date}. Timezone: ${timeZone} (${offset}).`,
    `Page: ${page}`,
    ...(reminder === '' ? [] : [reminder]),
  ].join('\n');
}
