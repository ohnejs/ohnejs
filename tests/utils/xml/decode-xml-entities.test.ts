import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeXMLEntities } from '../../../src/utils/index.ts';

describe('decodeXMLEntities', () => {
  it('decodes the predefined named entities', () => {
    strictEqual(decodeXMLEntities('&amp;&lt;&gt;&quot;&apos;'), `&<>"'`);
  });

  it('decodes decimal and hexadecimal character references', () => {
    strictEqual(decodeXMLEntities('&#65;&#x42;&#X43;&#x1F600;'), 'AB&#X43;😀');
  });

  it('decodes in one pass', () => {
    strictEqual(decodeXMLEntities('&amp;lt;'), '&lt;');
  });

  it('keeps unknown entities and out-of-range references as written', () => {
    strictEqual(decodeXMLEntities('&nbsp; &AMP; &#x110000;'), '&nbsp; &AMP; &#x110000;');
  });
});
