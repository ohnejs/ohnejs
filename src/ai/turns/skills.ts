import type { SkillDefinition } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { useSkills } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { isString, isUndefined } from 'ohnejs/utils';

/**
 * The skill `name` when `user` may run it: registered, and without a capability or with one they hold.
 *
 * @example
 * ```ts
 * usableSkill(officer, 'translate-items')?.prompt // -> 'Translate every item.'
 * usableSkill(reader, 'translate-items')          // -> undefined
 * ```
 */
export function usableSkill(user: User, name: unknown): SkillDefinition | undefined {
  const skill = isString(name) ? useSkills().get(name)?.skill : undefined;
  if (isUndefined(skill) || (!isUndefined(skill.capability) && !userCan(user, skill.capability))) {
    return undefined;
  }
  return skill;
}
