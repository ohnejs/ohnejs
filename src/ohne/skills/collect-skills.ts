import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { SkillDefinition } from './define-skill.ts';

import { isPlainObject, isString } from '../../utils/index.ts';
import {
  collectLayerFiles,
  type CollectedFile,
  type CollectLayerFilesOptions,
} from '../layers/collect-layer-files.ts';

/**
 * One skill with its imported definition under `skill`, ready for codegen.
 */
export type CollectedSkill = CollectedFile<'skill', SkillDefinition>;

/**
 * Combines the skills of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.skills` (default `'skills'`).
 * A closer layer's skill replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export function collectSkills(
  layers: readonly OhneLayer[],
  options: CollectLayerFilesOptions = {},
): Promise<CollectedSkill[]> {
  return collectLayerFiles('skill', layers, isSkillDefinition, options);
}

/**
 * Whether a default export has the shape of a `defineSkill` result.
 */
function isSkillDefinition(definition: unknown): definition is SkillDefinition {
  return isPlainObject(definition) && isString(definition.prompt);
}
