import type { Dialect } from './dialect.ts';

import { isAbsolutePath, isUndefined, joinPath } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { appRoot } from '../layers/app-root.ts';
import { DEFAULT_DATABASE_URL, DEFAULT_DIALECT } from '../layers/config.ts';
import { useConfig } from '../layers/use-config.ts';
import { clearDatabases, registerDatabase, registerDialect } from './use-database.ts';
import { useDialects } from './use-dialects.ts';

/**
 * Resolves database config and env, opens the main connection and every helper, and registers them.
 *
 * Runs in `serveAPI` before `listen`; returns the selected dialect for the sync that follows.
 * The main URL comes from `DATABASE` or `DB` environment variables, then `database.url`, then the default.
 * A plain relative path resolves against the app root rather than the process working directory.
 * `closeDatabases` closes everything this opened; the caller sequences it after the server drain.
 */
export async function connect(): Promise<Dialect> {
  const config = useConfig().database;
  const dialectName = config?.dialect ?? DEFAULT_DIALECT;
  const dialect = useDialects().get(dialectName);
  if (isUndefined(dialect)) {
    throw ohneError({
      title: `Unknown database dialect \`${dialectName}\``,
      body: [
        `No dialect is registered under \`${dialectName}\`.`,
        'Add the layer that provides it, or set `database.dialect` to a registered one.',
      ],
    });
  }

  const url = resolveMainURL(config?.url);

  clearDatabases();
  registerDialect(dialect);
  registerDatabase(await dialect.connect(rootRelative(url)));
  for (const [name, helperURL] of Object.entries(config?.helpers ?? {})) {
    registerDatabase(await dialect.connect(rootRelative(helperURL)), name);
  }
  return dialect;
}

/**
 * Resolves a plain relative path against the app root.
 * `:memory:`, `file:` URLs, driver URLs carrying a scheme, and absolute paths pass through untouched.
 */
function rootRelative(url: string): string {
  if (url === ':memory:' || url.startsWith('file:') || url.includes('://') || isAbsolutePath(url)) {
    return url;
  }
  return joinPath(appRoot(), url);
}

/**
 * Resolves the main-database URL: `DATABASE` or `DB` (setting both throws), then config, then the default.
 */
function resolveMainURL(configURL: string | undefined): string {
  const env = useEnv();
  if (env.has('DATABASE') && env.has('DB')) {
    throw ohneError({
      title: 'Both `DATABASE` and `DB` are set',
      body: [
        '`DATABASE` and `DB` are aliases for the main database URL, so ohne cannot tell which you meant.',
        'Set only one of them.',
      ],
    });
  }
  return env.get('DATABASE') ?? env.get('DB') ?? configURL ?? DEFAULT_DATABASE_URL;
}
