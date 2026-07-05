import { isUndefined } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DEFAULT_DATABASE_URL, DEFAULT_DIALECT } from '../layers/config.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { clearDatabases, registerDatabase } from './use-database.ts';
import { useDialects } from './use-dialects.ts';

/**
 * Resolves database config and env, opens the main connection and every helper, and registers them.
 *
 * Runs in `serveAPI` before `listen`.
 * The main URL comes from `DATABASE` or `DB` environment variables, then `database.url`, then the default.
 * Each open connection is closed on shutdown, in registration order.
 */
export async function connect(): Promise<void> {
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

  const main = await dialect.connect(url);
  registerDatabase(main);
  onShutdown(() => main.close());

  for (const [name, helperURL] of Object.entries(config?.helpers ?? {})) {
    const helper = await dialect.connect(helperURL);
    registerDatabase(helper, name);
    onShutdown(() => helper.close());
  }
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
