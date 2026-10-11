import { ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { FakeElement } from '../_fake-dom.ts';

import { iconShape } from '../../../src/ohne/dashboard/icon-shapes.ts';
import '../_fake-dom.ts';

const { icon } = await import('../../../src/dashboard/ui/icon.ts');

const MEDIA = [
  'alert-triangle',
  'arrows-move',
  'circle-off',
  'cloud-upload',
  'download',
  'external-link',
  'file',
  'file-upload',
  'focus-2',
  'folder-open',
  'folder-plus',
  'forbid',
  'library-photo',
  'music',
  'photo',
  'photo-off',
  'photo-up',
  'replace',
  'upload',
  'video',
];

/**
 * The inlined table, read as text rather than imported, so the check sees the literal source.
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

  it('holds the media set, so the uploads chrome paints with the first frame', () => {
    const inlined = inlinedShapes();
    for (const name of MEDIA) ok(inlined.has(name), `\`${name}\` is not inlined`);
  });
});

describe('icon', () => {
  it('sizes to the surrounding text and keeps its color without options', () => {
    const svg = icon('check') as unknown as FakeElement;
    strictEqual(svg.getAttribute('class'), 'ohne-icon');
    strictEqual(svg.getAttribute('style'), null);
  });

  it('paints a tone and pins a size step', () => {
    const svg = icon('check', { tone: 'success', size: 2 }) as unknown as FakeElement;
    strictEqual(
      svg.getAttribute('class'),
      'ohne-icon ohne-icon-toned ohne-tone-success ohne-icon-sized',
    );
    strictEqual(svg.getAttribute('style'), '--ohne-size: 2');
  });
});
