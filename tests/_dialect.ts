import { writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DatabaseAdapter } from '../src/ohne/database/adapter.ts';
import type { Dialect } from '../src/ohne/database/dialect.ts';

import { useDialects } from '../src/ohne/database/use-dialects.ts';
import { isUndefined } from '../src/utils/index.ts';

/**
 * The engine a database-touching test runs on.
 * `OHNE_TEST_DIALECT` names a module that named-exports exactly these members; unset, it is SQLite.
 */
export interface TestDialect {
  /**
   * The dialect instance tests and `connect()` use.
   * The seam registers it under its own `name`.
   */
  dialect: Dialect;

  /**
   * A URL where every connect opens a fresh, empty database that vanishes on close.
   */
  memoryURL: string;

  /**
   * Returns the URL of a fresh database that every connect to it shares.
   * It survives a close, so a test can reopen what it wrote.
   */
  sharedURL(): Promise<string>;

  /**
   * Returns an error `dialect.isBusy` accepts.
   */
  busyError(): unknown;

  /**
   * Makes every `DELETE` on `table` throw an error whose message contains `bound`.
   * The returned function undoes it.
   */
  failDeletes(db: DatabaseAdapter, table: string): Promise<() => Promise<void>>;

  /**
   * Links the layers that run a project on this engine into the `node_modules` of `project`.
   * Returns their names, for the project's `ohne.config.ts` to list.
   */
  linkLayers(project: string): string[];
}

const spec = process.env.OHNE_TEST_DIALECT;

const selected: TestDialect = isUndefined(spec)
  ? await import('./_sqlite-dialect.ts')
  : await import(pathToFileURL(resolvePath(spec)).href);

useDialects().register(selected.dialect.name, selected.dialect);

/**
 * The selected module's members, see `TestDialect`.
 */
export const { dialect, memoryURL, sharedURL, busyError, failDeletes, linkLayers } = selected;

/**
 * Opens a fresh, empty database on the test dialect that vanishes on close.
 */
export function connectTest(): Promise<DatabaseAdapter> {
  return dialect.connect(memoryURL);
}

/**
 * Readies the project at `dir` for an `ohne` child process on the test dialect.
 * Its `ohne.config.ts` stacks the dialect's layers, then `layers`.
 * Its `.env` points `DATABASE` at a fresh shared database.
 * Returns that database's URL, which opens what the child wrote.
 */
export async function prepareProject(dir: string, layers: string[] = []): Promise<string> {
  const url = await sharedURL();
  const stack = [...linkLayers(dir), ...layers];
  writeFileSync(
    join(dir, 'ohne.config.ts'),
    `export default { layers: ${JSON.stringify(stack)} };\n`,
  );
  writeFileSync(join(dir, '.env'), `DATABASE=${url}\n`);
  return url;
}
