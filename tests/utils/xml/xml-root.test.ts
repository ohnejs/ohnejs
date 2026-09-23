import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { xmlRoot } from '../../../src/utils/index.ts';

describe('xmlRoot', () => {
  it('names the root past the declaration and whitespace', () => {
    strictEqual(
      xmlRoot('<?xml version="1.0" encoding="UTF-8"?>\n\n  <Error><Code>x</Code></Error>'),
      'Error',
    );
  });

  it('names a root without a declaration', () => {
    strictEqual(
      xmlRoot('<CompleteMultipartUploadResult xmlns="x"/>'),
      'CompleteMultipartUploadResult',
    );
  });

  it('returns undefined for text that opens with no element', () => {
    strictEqual(xmlRoot(''), undefined);
    strictEqual(xmlRoot('not xml'), undefined);
    strictEqual(xmlRoot('<?xml version="1.0"?>'), undefined);
  });
});
