import { ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { iconShape } from '../../../src/ohne/dashboard/icon-shapes.ts';

/**
 * The inlined table, read as text rather than imported.
 * `src/dashboard/ui/icon.ts` is browser code that touches `document`, so a Node test cannot load it.
 * Every shape is a single-quoted string whose markup quotes attributes with `"`.
 */
function inlinedShapes(): Map<string, string> {
  const source = readFileSync(
    new URL('../../../src/dashboard/ui/icon.ts', import.meta.url),
    'utf8',
  );
  const table = source.slice(source.indexOf('= {'), source.indexOf('\n};'));
  const entries = table.matchAll(/^ {2}'?([a-z0-9-]+)'?:\s*(?:\n\s*)?'([^']*)',$/gm);
  return new Map([...entries].map((entry) => [entry[1]!, entry[2]!]));
}

describe('the icons the dashboard inlines', () => {
  it('parses out of the module, so the checks below mean something', () => {
    ok(inlinedShapes().size > 50);
  });

  it('draws exactly what the server would serve for the same name', () => {
    for (const [name, shape] of inlinedShapes()) {
      ok(iconShape(name) === shape, `inlined \`${name}\` has drifted from the vendored set`);
    }
  });
});
