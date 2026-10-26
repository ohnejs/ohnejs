import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { escapeMarkdown } from '../../../src/utils/index.ts';

describe('escapeMarkdown', () => {
  it('escapes every ASCII punctuation mark', () => {
    strictEqual(escapeMarkdown('[a](b) *c* `d`'), '\\[a\\]\\(b\\) \\*c\\* \\`d\\`');
  });

  it('leaves letters, digits, spaces and other scripts alone', () => {
    strictEqual(escapeMarkdown('Über uns 2024'), 'Über uns 2024');
  });

  it('escapes a backslash too, so it reads as itself', () => {
    strictEqual(escapeMarkdown('a\\b'), 'a\\\\b');
  });
});
