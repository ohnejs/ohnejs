import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { xmlText } from '../../../src/utils/index.ts';

const ERROR = `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchKey</Code><Message>The key &amp; more</Message><Key>a/b.txt</Key></Error>`;

describe('xmlText', () => {
  it('reads the first element text, entity-decoded', () => {
    strictEqual(xmlText(ERROR, 'Code'), 'NoSuchKey');
    strictEqual(xmlText(ERROR, 'Message'), 'The key & more');
  });

  it('matches the exact name only', () => {
    strictEqual(xmlText('<R><KeyCount>2</KeyCount><Key>k</Key></R>', 'Key'), 'k');
    strictEqual(xmlText('<R><KeyCount>2</KeyCount></R>', 'Key'), undefined);
  });

  it('reads a self-closing element as empty', () => {
    strictEqual(xmlText('<R><Prefix/></R>', 'Prefix'), '');
    strictEqual(xmlText('<R><Prefix /></R>', 'Prefix'), '');
  });

  it('allows attributes', () => {
    strictEqual(xmlText('<R><ETag kind="md5">"abc"</ETag></R>', 'ETag'), '"abc"');
    strictEqual(xmlText('<R><Owner id="1"/></R>', 'Owner'), '');
  });

  it('keeps a > or /> inside a quoted attribute value in the start tag', () => {
    strictEqual(xmlText('<R><Key a="x>y">v</Key></R>', 'Key'), 'v');
    strictEqual(xmlText('<R><Key a=\'x/>y\' b="2">v</Key></R>', 'Key'), 'v');
  });

  it('returns the first of several', () => {
    strictEqual(xmlText('<R><Key>a</Key><Key>b</Key></R>', 'Key'), 'a');
  });

  it('treats the tag as a literal name', () => {
    strictEqual(xmlText('<R><a.b>x</a.b><axb>y</axb></R>', 'a.b'), 'x');
    strictEqual(xmlText('<R><axb>y</axb></R>', 'a.b'), undefined);
  });
});
