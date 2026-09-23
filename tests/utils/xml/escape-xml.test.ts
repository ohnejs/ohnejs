import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeXMLEntities, escapeXML } from '../../../src/utils/index.ts';

describe('escapeXML', () => {
  it('escapes every special character', () => {
    strictEqual(
      escapeXML(`<a href="x">it's & more</a>`),
      '&lt;a href=&quot;x&quot;&gt;it&apos;s &amp; more&lt;/a&gt;',
    );
  });

  it('leaves plain text alone', () => {
    strictEqual(escapeXML('photos/2024/sunset.jpg'), 'photos/2024/sunset.jpg');
  });

  it('round-trips through decodeXMLEntities', () => {
    const value = `&amp; <'"> &lt;`;
    strictEqual(decodeXMLEntities(escapeXML(value)), value);
  });
});
