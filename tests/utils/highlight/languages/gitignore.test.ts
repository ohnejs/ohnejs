import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeGitignore } from '../../../../src/utils/highlight/languages/gitignore.ts';

const spans = (code: string) =>
  tokenizeGitignore(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeGitignore', () => {
  it('classifies a line starting with `#` as a comment', () => {
    deepStrictEqual(spans('# deps\nnode_modules\n# build\ndist/'), [
      ['comment', '# deps'],
      ['comment', '# build'],
    ]);
  });

  it('leaves a `#` inside a pattern plain', () => {
    deepStrictEqual(spans('a#b\n\\#c'), []);
  });
});
