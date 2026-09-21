import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { renderTemplate } from '../../../src/utils/index.ts';

describe('renderTemplate', () => {
  it('renders every field with its literals', () => {
    strictEqual(
      renderTemplate('{last}, {first}', { last: 'Wrynn', first: 'Anduin' }),
      'Wrynn, Anduin',
    );
  });

  it('drops a literal beside an absent field', () => {
    strictEqual(renderTemplate('{last}, {first}', { last: 'Wrynn' }), 'Wrynn');
    strictEqual(renderTemplate('{last}, {first}', { first: 'Anduin' }), 'Anduin');
  });

  it('drops leading and trailing literals with their fields', () => {
    strictEqual(renderTemplate('{title} ({year})', { title: 'Dune', year: '1965' }), 'Dune (1965)');
    strictEqual(renderTemplate('{title} ({year})', { title: 'Dune' }), 'Dune');
  });

  it('treats empty strings and non-strings as absent', () => {
    strictEqual(renderTemplate('{a}-{b}', { a: '', b: 7 }), '');
    strictEqual(renderTemplate('{a}-{b}', { a: 'x', b: null }), 'x');
  });

  it('renders an empty string when every field is absent', () => {
    strictEqual(renderTemplate('{last}, {first}', {}), '');
  });

  it('keeps a literal between rendered adjacent fields', () => {
    strictEqual(renderTemplate('{a}{b}', { a: 'x', b: 'y' }), 'xy');
  });

  it('returns a malformed template unchanged', () => {
    strictEqual(renderTemplate('{oops', { oops: 'x' }), '{oops');
  });
});
