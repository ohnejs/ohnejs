import { generateDatabase } from '../../codegen/generate-database.ts';
import { collectMigrations } from '../../database/migrations/collect-migrations.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The database target.
 * Its closure is every layer's `dirs.migrations`; it regenerates `database.ts` when that file set changes.
 */
export function createDatabaseTarget(from: string): SetTarget {
  return createSetTarget('database', from, 'migrations', migrationFiles, generateDatabase);
}

async function migrationFiles(): Promise<Set<string>> {
  const migrations = await collectMigrations(stackedLayers());
  return new Set(migrations.map((migration) => migration.file));
}
