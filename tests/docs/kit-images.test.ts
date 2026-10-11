import { deepStrictEqual } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const DOCS = join(import.meta.dirname, '../../docs');
const IMAGES = join(DOCS, 'images/kit');
const REFERENCE = /images\/kit\/([a-z0-9-]+)-(light|dark)\.png/g;

/**
 * Every markdown file under `dir`, recursively.
 */
function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const referenced = new Set(
  markdownFiles(DOCS).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(REFERENCE)].map((match) => match[1]!),
  ),
);
const shipped = readdirSync(IMAGES).filter((name) => name.endsWith('.png'));

describe('docs kit images', () => {
  it('ships every referenced picture in both themes', () => {
    const missing = [...referenced]
      .flatMap((slug) => [`${slug}-light.png`, `${slug}-dark.png`])
      .filter((name) => !shipped.includes(name));
    deepStrictEqual(missing, []);
  });

  it('ships no picture the docs never show', () => {
    const orphans = shipped.filter(
      (name) => !referenced.has(name.replace(/-(light|dark)\.png$/, '')),
    );
    deepStrictEqual(orphans, []);
  });
});
