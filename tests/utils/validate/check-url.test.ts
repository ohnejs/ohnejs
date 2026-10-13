import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkURL } from '../../../src/utils/index.ts';

describe('checkURL', () => {
  it('accepts an absolute web address', () => {
    strictEqual(checkURL('https://dalaran.example'), undefined);
  });

  it('names anything else an invalid URL', () => {
    strictEqual(checkURL('dalaran.example'), 'validation.invalidURL');
    strictEqual(checkURL('/path'), 'validation.invalidURL');
  });
});
