import { fileURLToPath } from 'node:url';

import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * The framework's browser tsconfig, the `extends` target of every generated browser bucket config.
 */
const BROWSER_TSCONFIG = fileURLToPath(new URL('../../../tsconfig.browser.json', import.meta.url));

/**
 * Generates `browser/tsconfig.json`, giving the browser bucket a program an editor can discover.
 *
 * An editor assigns an open file to the nearest ancestor `tsconfig.json` that includes it.
 * The app's dashboard config covers the bucket but sits beside it, so that walk never finds one.
 * An unclaimed bucket file lands in an inferred project, whose resolution misses `ohne/dashboard`.
 * The config `extends` the framework's browser tsconfig by absolute path, so it resolves anywhere.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateBrowserTSConfig(
  from: string = process.cwd(),
): Promise<string | null> {
  const dir = await codegenBucket(from, 'browser');
  if (isNull(dir)) return null;

  const code = createCodeBuilder();
  code.line('{');
  code.indent(() => {
    code.line(`"extends": ${JSON.stringify(BROWSER_TSCONFIG)},`);
    code.line('"include": ["./**/*.ts"]');
  });
  code.line('}');
  return write(dir, code);
}

async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('tsconfig.json', code.toString());
  return gen.path('tsconfig.json');
}
