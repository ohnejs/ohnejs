import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkJSONText } from '../../../src/utils/validate/check-json-text.ts';

describe('checkJSONText', () => {
  it('accepts any JSON text, formatting kept aside', () => {
    strictEqual(checkJSONText('{\n  "level": 60\n}\n'), undefined);
    strictEqual(checkJSONText('[1, 2]'), undefined);
    strictEqual(checkJSONText('"Thrall"'), undefined);
    strictEqual(checkJSONText('null'), undefined);
  });

  it('names text that does not parse invalid JSON', () => {
    strictEqual(checkJSONText('{ level: 60 }'), 'validation.invalidJSON');
    strictEqual(checkJSONText('[1, 2,]'), 'validation.invalidJSON');
    strictEqual(checkJSONText(''), 'validation.invalidJSON');
  });
});
