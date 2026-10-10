import { doesNotThrow, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { validateFrameAncestors } from '../../../src/ohne/index.ts';

const file = '/app/ohne.config.ts';

function caught(fn: () => void): { title: string; body: string; path?: string } {
  try {
    fn();
  } catch (error) {
    const { title, body, path } = error as {
      title: string;
      body: string | string[];
      path?: string;
    };
    return { title, body: Array.isArray(body) ? body.join('\n') : body, path };
  }
  throw new Error('expected a throw');
}

describe('validateFrameAncestors', () => {
  it('accepts bare origins and an empty list', () => {
    doesNotThrow(() => validateFrameAncestors(['https://ohne.dev', 'http://localhost:3000'], file));
    doesNotThrow(() => validateFrameAncestors([], file));
  });

  it('names the offending entry and the config file', () => {
    const error = caught(() =>
      validateFrameAncestors(['https://ohne.dev', 'https://*.ohne.dev'], file),
    );
    strictEqual(error.title.includes('https://*.ohne.dev'), true);
    strictEqual(error.path, file);
    strictEqual(error.body.includes('Did you mean'), false);
  });

  it('suggests the origin a near-miss parses to', () => {
    const error = caught(() => validateFrameAncestors(['https://Ohne.dev/admin'], file));
    strictEqual(error.body.includes('Did you mean `https://ohne.dev`?'), true);
  });

  it('refuses directive injection', () => {
    throws(() => validateFrameAncestors(['https://a.dev;script-src'], file));
    throws(() => validateFrameAncestors(["'self'"], file));
  });
});
