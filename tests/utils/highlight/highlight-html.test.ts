import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { highlightHTML } from '../../../src/utils/highlight/highlight-html.ts';

describe('highlightHTML', () => {
  it('wraps each token in a span named by its kind', () => {
    strictEqual(
      highlightHTML('const a = 1', 'ts'),
      '<span class="tk-keyword">const</span> a = <span class="tk-number">1</span>',
    );
  });

  it('escapes the text inside and between tokens', () => {
    strictEqual(
      highlightHTML(`a < "<b>" && 'c'`, 'ts'),
      'a &lt; <span class="tk-string">&quot;&lt;b&gt;&quot;</span> &amp;&amp; ' +
        '<span class="tk-string">&apos;c&apos;</span>',
    );
  });

  it('keeps newlines and indentation', () => {
    strictEqual(
      highlightHTML('{\n\t"a": 1\n}', 'json'),
      '{\n\t<span class="tk-property">&quot;a&quot;</span>: <span class="tk-number">1</span>\n}',
    );
  });

  it('returns escaped text for an unknown language', () => {
    strictEqual(highlightHTML('<a href="x">', 'cobol'), '&lt;a href=&quot;x&quot;&gt;');
  });

  it('returns an empty string for empty code', () => {
    strictEqual(highlightHTML('', 'ts'), '');
  });
});
