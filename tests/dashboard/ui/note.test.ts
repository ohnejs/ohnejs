import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { type FakeElement } from '../_fake-dom.ts';

const { note } = await import('../../../src/dashboard/ui/note.ts');

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

function fake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

describe('note', () => {
  it('stays quiet without a tone', () => {
    strictEqual(fake(note('Hint')).getAttribute('class'), 'ohne-note');
  });

  it('tints and rings the note in a status tone', () => {
    strictEqual(
      fake(note('Careful', { tone: 'warning' })).getAttribute('class'),
      'ohne-note ohne-note-toned ohne-note-status ohne-tone-warning',
    );
  });

  it('fills the note in a surface tone, with no ring', () => {
    strictEqual(
      fake(note('Heads up', { tone: 'accent' })).getAttribute('class'),
      'ohne-note ohne-note-toned ohne-tone-accent',
    );
  });

  it('keeps a primary note plain, as a primary alert is', () => {
    strictEqual(fake(note('Hint', { tone: 'primary' })).getAttribute('class'), 'ohne-note');
  });
});
