import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const TYPESCRIPT = /\.m?ts$/;
const DECLARATION = /\.d\.m?ts$/;

silenceFirstStripWarning();

registerHooks({
  load(url, context, nextLoad) {
    if (!url.includes('/node_modules/') || !TYPESCRIPT.test(url) || DECLARATION.test(url)) {
      return nextLoad(url, context);
    }
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      source: stripTypeScriptTypes(source, { sourceUrl: url }),
      shortCircuit: true,
    };
  },
});

/**
 * Spend `stripTypeScriptTypes`'s one-time experimental warning up front, with warnings muted.
 * Node dedupes it per process, so later strips stay silent and every other warning still reaches the user.
 */
function silenceFirstStripWarning() {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  stripTypeScriptTypes('');
  process.emitWarning = emitWarning;
}
