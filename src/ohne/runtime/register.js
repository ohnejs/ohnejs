import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

import { silenceFirstStripWarning } from '../../utils/imports/silence-strip-warning.js';

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
