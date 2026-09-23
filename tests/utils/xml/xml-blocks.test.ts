import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { xmlBlocks, xmlText } from '../../../src/utils/index.ts';

const LIST = `<ListBucketResult>
  <KeyCount>2</KeyCount>
  <Contents><Key>a.txt</Key><Size>1</Size></Contents>
  <Contents><Key>b.txt</Key><Size>2</Size></Contents>
</ListBucketResult>`;

describe('xmlBlocks', () => {
  it('returns the inner XML of every element, in order', () => {
    deepStrictEqual(
      xmlBlocks(LIST, 'Contents').map((block) => xmlText(block, 'Key')),
      ['a.txt', 'b.txt'],
    );
  });

  it('keeps the inner XML raw', () => {
    deepStrictEqual(xmlBlocks('<R><Key>a &amp; b</Key></R>', 'Key'), ['a &amp; b']);
  });

  it('yields an empty string for a self-closing element', () => {
    deepStrictEqual(xmlBlocks('<R><Part/><Part>x</Part></R>', 'Part'), ['', 'x']);
  });

  it('matches the exact name only', () => {
    deepStrictEqual(xmlBlocks('<R><PartCount>1</PartCount></R>', 'Part'), []);
  });
});
