import type { ScannedFile } from '../layers/scan-layer-files.ts';
import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { SkillDefinition } from './define-skill.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isPlainObject, isString, naturalCompare } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { scanLayerFiles } from '../layers/scan-layer-files.ts';
import { useLayers } from '../layers/use-layers.ts';

/**
 * One skill with its imported definition, ready for codegen.
 */
export interface CollectedSkill extends ScannedFile {
  /**
   * The definition the file default-exports.
   */
  skill: SkillDefinition;
}

/**
 * Options for `collectSkills`.
 */
export interface CollectSkillsOptions {
  /**
   * Skill names to drop after the merge, matched exactly.
   *
   * @default
   * []
   */
  disable?: readonly string[];

  /**
   * Re-import each definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Combines the skills of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.skills` (default `'skills'`).
 * A closer layer's skill replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export async function collectSkills(
  layers: readonly OhneLayer[],
  options: CollectSkillsOptions = {},
): Promise<CollectedSkill[]> {
  const { disable = [], fresh = false } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedFile>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.skills ?? DIR_DEFAULTS.skills;
    for (const scanned of await scanLayerFiles('skill', layer, dir)) {
      byName.set(scanned.name, scanned);
    }
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  return Promise.all(
    survivors.map(async (scanned) => ({
      ...scanned,
      skill: await definitionOf(scanned, fresh),
    })),
  );
}

/**
 * Imports one skill's definition and rejects a file that does not default-export one.
 */
async function definitionOf(scanned: ScannedFile, fresh: boolean): Promise<SkillDefinition> {
  const definition = await importDefault<SkillDefinition>(scanned.file, { fresh });
  if (!isPlainObject(definition) || !isString(definition.prompt)) {
    throw ohneError({
      title: `Skill \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineSkill(...)` result from the file.'],
      path: scanned.file,
    });
  }
  return definition;
}
