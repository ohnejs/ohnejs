import type { SkillDefinition } from './define-skill.ts';
import type { SkillName } from './known-skills.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One registered skill: its name and its definition.
 */
export interface SkillMeta {
  /**
   * The skill name, taken from its file.
   */
  name: SkillName;

  /**
   * The skill definition.
   */
  skill: SkillDefinition;
}

const registry: Registry<SkillMeta> = createRegistry<SkillMeta>();

/**
 * Returns the process-wide skill registry, keyed by skill name.
 *
 * Core ships no skills; codegen registers every layer's own.
 * A name that already exists is overridden, so a skill from a closer layer wins.
 *
 * @example
 * ```ts
 * useSkills().get('translate-items')?.skill.prompt // -> 'Read the items ...'
 * ```
 */
export function useSkills(): Registry<SkillMeta> {
  return registry;
}
