import { generateSkills } from '../../codegen/generate-skills.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { collectSkills } from '../../skills/collect-skills.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The skill table target.
 * Its closure is every layer's `dirs.skills`; it regenerates `skills.ts` when that file set changes.
 * Definitions re-import fresh, so a skill file once read in a broken state recovers on the next cycle.
 */
export function createSkillsTarget(from: string): SetTarget {
  return createSetTarget('skills', from, 'skills', skillFiles, (dir) =>
    generateSkills(dir, { fresh: true }),
  );
}

/**
 * The source files of every stacked layer's skills, re-imported fresh so a fixed file recovers.
 */
async function skillFiles(): Promise<Set<string>> {
  const skills = await collectSkills(stackedLayers(), { fresh: true });
  return new Set(skills.map((skill) => skill.file));
}
