import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { htmlToText } from '../../../src/utils/index.ts';

describe('htmlToText', () => {
  it('reads a page as lines without scripts, styles, head, or comments', () => {
    const page = `<!DOCTYPE html>
      <html>
        <head><title>Bäckerei</title><style>p { color: red }</style></head>
        <body>
          <!-- navigation -->
          <header><h1>B&auml;ckerei   Huber</h1></header>
          <script>window.track('a < b')</script>
          <ul>
            <li>Br&#228;tzeln</li>
            <li>Kuchen
              <ul><li>K&#xE4;sekuchen</li></ul>
            </li>
          </ul>
          <p>Tel.&nbsp;089&nbsp;123<br/>Mo &amp; Di</p>
          <noscript>Bitte JavaScript</noscript><svg><text>logo</text></svg>
          <template><p>hidden</p></template>
        </body>
      </html>`;
    strictEqual(
      htmlToText(page),
      [
        'Bäckerei Huber',
        '',
        'Brätzeln',
        '',
        'Kuchen',
        '',
        'Käsekuchen',
        '',
        'Tel. 089 123',
        'Mo & Di',
      ].join('\n'),
    );
  });

  it('spaces table cells apart and keeps inline markup inline', () => {
    strictEqual(
      htmlToText('<table><tr><td>Preis</td><td><b>49</b>,00 &euro;</td></tr></table>'),
      'Preis 49,00 &euro;',
    );
  });

  it('decodes in one pass', () => {
    strictEqual(htmlToText('&amp;auml; &amp;#228; &Uuml;&szlig;&yuml;'), '&auml; &#228; Üßÿ');
  });

  it('drops an unclosed script and comment to the end', () => {
    strictEqual(htmlToText('<p>Hallo</p><script>never closed'), 'Hallo');
    strictEqual(htmlToText('Hallo<!-- open'), 'Hallo');
  });

  it('returns an empty string for markup without text', () => {
    strictEqual(htmlToText('<div><br><p></p></div>'), '');
  });
});
