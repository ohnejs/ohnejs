import { deepStrictEqual, ok } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SRC = new URL('../../../src/dashboard/', import.meta.url);

const SINKS: readonly [string, RegExp][] = [
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write/],
  ['execCommand', /\bexecCommand\b/],
  ['createContextualFragment', /\bcreateContextualFragment\b/],
  ['importNode', /\bimportNode\b/],
  ['adoptNode', /\badoptNode\b/],
];

/**
 * The editor's modules and the link field files that exist, as paths under `src/dashboard`.
 */
function guarded(): string[] {
  const editor = readdirSync(new URL('ui/', SRC))
    .filter((name) => name.startsWith('rich-text-') && name.endsWith('.ts'))
    .map((name) => `ui/${name}`);
  const fields = ['rich-text', 'link', '_link-popup']
    .map((name) => `fields/builtin/${name}.ts`)
    .filter((path) => existsSync(new URL(path, SRC)));
  return [...editor, ...fields];
}

/**
 * The markup sinks a source text names.
 */
function sinksIn(source: string): string[] {
  return SINKS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

describe('the rich text markup sink guard', () => {
  it('finds the editor modules, so the guard checks something', () => {
    const files = guarded();
    for (const name of ['model', 'commands', 'keys', 'dom', 'input', 'editor']) {
      ok(files.includes(`ui/rich-text-${name}.ts`), `\`ui/rich-text-${name}.ts\` is not guarded`);
    }
  });

  it('names every sink it is meant to catch', () => {
    deepStrictEqual(
      sinksIn(
        'a.innerHTML = b; a.outerHTML; a.insertAdjacentHTML(); document.write(x); ' +
          "document['execCommand']; r.createContextualFragment(); d.importNode(); d.adoptNode()",
      ),
      SINKS.map(([name]) => name),
    );
  });

  it('finds no markup sink in the editor or the link field files', () => {
    for (const path of guarded()) {
      const found = sinksIn(readFileSync(new URL(path, SRC), 'utf8'));
      deepStrictEqual(found, [], `\`src/dashboard/${path}\` uses ${found.join(', ')}`);
    }
  });
});
