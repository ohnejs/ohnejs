import type { Dialect } from './dialect.ts';
import type { DialectName } from './known-dialects.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
import { isUndefined, redactURL } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DEFAULT_DATABASE_URL, DEFAULT_DIALECT } from '../layers/config.ts';
import { useConfig } from '../layers/use-config.ts';
import { clearDatabases, registerDatabase, registerDialect } from './use-database.ts';
import { useDialects } from './use-dialects.ts';

/**
 * Resolves database config and env, opens the main connection and every helper, and registers them.
 *
 * Runs in `serveAPI` before `listen`; returns the selected dialect for the sync that follows.
 * The main URL comes from `DATABASE` or `DB` environment variables, then `database.url`, then the default.
 * The dialect is `database.dialect`, else the first registered one that accepts the main URL.
 * Every URL, helpers included, must be one the dialect accepts.
 * `closeDatabases` closes everything this opened; the caller sequences it after the server drain.
 */
export async function connect(): Promise<Dialect> {
  const config = useConfig().database;
  const url = resolveMainURL(config?.url);
  const dialect = isUndefined(config?.dialect) ? inferDialect(url) : namedDialect(config.dialect);
  const helpers = Object.entries(config?.helpers ?? {});

  assertAccepts(dialect, url, 'Set `DATABASE` or `database.url` to a URL it can open.');
  for (const [name, helperURL] of helpers) {
    assertAccepts(dialect, helperURL, `Set \`database.helpers.${name}\` to a URL it can open.`);
  }

  clearDatabases();
  registerDialect(dialect);
  registerDatabase(await dialect.connect(url));
  for (const [name, helperURL] of helpers) {
    registerDatabase(await dialect.connect(helperURL), name);
  }
  return dialect;
}

/**
 * The dialect registered under `name`, which a configured `database.dialect` must name.
 */
function namedDialect(name: DialectName): Dialect {
  const dialect = useDialects().get(name);
  if (isUndefined(dialect)) {
    throw ohneError({
      title: `Unknown database dialect \`${name}\``,
      body: [
        `No dialect is registered under \`${name}\`.`,
        'ohne ships `sqlite`, and `@ohnejs/pg` adds `postgres`.',
        'Add the layer that provides it, or set `database.dialect` to a registered one.',
      ],
    });
  }
  return dialect;
}

/**
 * The first registered dialect that accepts `url`, else the default one.
 * Registration order holds, so the built-in `sqlite` is asked first and claims only non-URL paths.
 */
function inferDialect(url: string): Dialect {
  const dialects = Object.values(useDialects().all());
  return dialects.find((dialect) => dialect.accepts(url)) ?? namedDialect(DEFAULT_DIALECT);
}

/**
 * Throws unless `dialect` accepts `url`, printing the URL without its secrets.
 * `fix` is the row that tells the reader which setting to change.
 */
function assertAccepts(dialect: Dialect, url: string, fix: string): void {
  if (dialect.accepts(url)) return;
  throw ohneError({
    title: `The database URL does not fit \`${dialect.name}\``,
    body: [`The \`${dialect.name}\` dialect cannot open ${codeSpan(redactURL(url))}.`, fix],
  });
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
