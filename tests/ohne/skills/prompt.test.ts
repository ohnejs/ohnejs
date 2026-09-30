import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPrompt, promptText } from '../../../src/ohne/skills/prompt.ts';

describe('promptText', () => {
  it('joins lines with line breaks and trims the whole', () => {
    strictEqual(promptText('  Answer briefly. '), 'Answer briefly.');
    strictEqual(promptText(['', 'Read first.', 'Then write.', '']), 'Read first.\nThen write.');
  });
});

describe('isPrompt', () => {
  it('takes a text or a list of strings with some text', () => {
    strictEqual(isPrompt('Answer briefly.'), true);
    strictEqual(isPrompt(['', 'Read first.']), true);
    strictEqual(isPrompt(' '), false);
    strictEqual(isPrompt(['', ' ']), false);
    strictEqual(isPrompt(['Read first.', 42]), false);
    strictEqual(isPrompt(42), false);
  });
});
