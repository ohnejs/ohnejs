import type { ScannedMigration } from '../database/migrations/scan-layer-migrations.ts';

import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
} from '../../utils/codegen/index.ts';
import { isNull, joinPath } from '../../utils/index.ts';
import { collectMigrations } from '../database/migrations/collect-migrations.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';

/**
 * Generates the database registrations from every layer's migrations directory.
 *
 * Emits `node/database.ts`, which imports each migration file and registers it into `useMigrations`.
 * Registration order is the execution order: furthest layer first, file name order within a layer.
 * The file is written even with no migrations, so a stale one never imports deleted files.
 *
 * Migrations are read from each layer's `Config.dirs.migrations` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the app's own `dirs.codegen` (default `.ohne`), resolved against that root.
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateDatabase(from: string = process.cwd()): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];
  const migrations = await collectMigrations(stackedLayers());
  return [await writeNode(joinPath(dir, 'node'), migrations)];
}

/**
 * Writes `node/database.ts`: imports every migration definition and registers it by name.
 */
async function writeNode(dir: string, migrations: readonly ScannedMigration[]): Promise<string> {
  const code = createCodeBuilder();
  if (migrations.length > 0) {
    code.line("import { useMigrations } from 'ohne';");
    migrations.forEach((migration, i) => {
      code.line(`import m${i} from ${literalString(importSpecifier(dir, migration.file))};`);
    });
    code.line();
    code.line('const migrations = useMigrations();');
    migrations.forEach((migration, i) => {
      code.line();
      code.line(`migrations.register(${literalString(migration.name)}, {`);
      code.indent(() => {
        code.line(`name: ${literalString(migration.name)},`);
        code.line(`migration: m${i},`);
        code.line(`file: ${literalString(migration.file)},`);
      });
      code.line('});');
    });
  }
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('database.ts', code.toString());
  return gen.path('database.ts');
}
