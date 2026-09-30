import type { SkillDefinition } from './define-skill.ts';

import { isMessage, isString, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { isPrompt } from './prompt.ts';

const MESSAGE = 'a message key, a plain string, or a `{ key, params }` object';

/**
 * Validates a skill definition.
 * `description` is required and `title` optional.
 * Each is a message key, a plain string, or a `{ key, params }` object.
 * `prompt` is a text or a list of lines that is not blank, and `capability` a non-empty string when set.
 */
export function validateSkillDefinition(definition: SkillDefinition): void {
  const {
    title,
    description,
    prompt,
    capability,
  }: Partial<Record<keyof SkillDefinition, unknown>> = definition;
  if (!isMessage(description)) throw invalid('description', MESSAGE);
  if (!isUndefined(title) && !isMessage(title)) throw invalid('title', MESSAGE);
  if (!isPrompt(prompt)) throw invalid('prompt', 'a non-blank string or list of strings');
  if (!isUndefined(capability) && (!isString(capability) || capability === '')) {
    throw invalid('capability', 'a non-empty capability string');
  }
}

/**
 * The failure for one option of the wrong shape.
 */
function invalid(option: string, expected: string): Error {
  return ohneError({
    title: 'Invalid skill definition',
    body: [`\`${option}\` must be ${expected}.`],
  });
}
