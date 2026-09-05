import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

import { silenceFirstStripWarning } from '../../utils/imports/silence-strip-warning.js';

const TYPESCRIPT = /\.m?ts$/;
const DECLARATION = /\.d\.m?ts$/;

silenceFirstStripWarning();

registerHooks({
  load(url, context, nextLoad) {
    // A fresh reload imports with a `?v=` query, so the tests run on the pathname alone.
    const { pathname } = new URL(url);
    if (
      !pathname.includes('/node_modules/') ||
      !TYPESCRIPT.test(pathname) ||
      DECLARATION.test(pathname)
    ) {
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
