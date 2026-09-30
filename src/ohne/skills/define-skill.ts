import type { Message } from '../messages/known-messages.ts';
import type { Capability } from '../roles/known-capabilities.ts';
import type { Prompt } from './prompt.ts';

import { validateSkillDefinition } from './validate-skill.ts';

/**
 * A skill definition: a named prompt the assistant runs when a person asks for it.
 * The skill name is not declared here; it comes from the file under `dirs.skills`.
 */
export interface SkillDefinition {
  /**
   * A short label for the skill, shown where the dashboard lists skills.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the skill name is sentence-cased: `translate-items` becomes `Translate items`.
   *
   * @example
   * ```ts
   * 'Translate items'
   * 'app.skills.translateItems.title'
   * ```
   */
  title?: Message;

  /**
   * What the skill does, in a sentence.
   * The dashboard shows it beside the title, and the assistant reads it to pick the skill.
   * Resolves like `title`.
   *
   * @example
   * ```ts
   * 'Translates the listed items into another locale.'
   * 'app.skills.translateItems.description'
   * ```
   */
  description: Message;

  /**
   * The instructions the assistant follows when the skill runs: one text, or a list of lines.
   *
   * @example
   * ```ts
   * [
   *   'Find the items that lack the target locale: `_translations` does not include it.',
   *   'Rewrite `name` and `tooltip` into the locale the person names.',
   * ]
   * ```
   */
  prompt: Prompt;

  /**
   * The capability a person must hold to see and run the skill.
   * Omitted, anyone who may use the assistant can run it.
   */
  capability?: Capability;
}

/**
 * Defines a skill.
 *
 * Default-export the result from a file under a layer's `dirs.skills`.
 * The file names the skill in kebab-case: `skills/translate-items.ts` becomes `translate-items`.
 *
 * @example
 * ```ts
 * // skills/translate-items.ts
 * import { defineSkill } from 'ohnejs'
 *
 * export default defineSkill({
 *   description: 'Translates the listed items into another locale.',
 *   prompt: 'Read the items the person names, then propose one translation per item.',
 * })
 * ```
 */
export function defineSkill(definition: SkillDefinition): SkillDefinition {
  validateSkillDefinition(definition);
  return definition;
}
