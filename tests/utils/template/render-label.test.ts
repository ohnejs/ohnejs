import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { renderLabel } from '../../../src/utils/index.ts';

describe('renderLabel', () => {
  it('joins the non-empty field values with spaces, in field order', () => {
    const values = { first: 'Anduin', middle: '', last: 'Wrynn', level: 60 };
    strictEqual(renderLabel(values, ['last', 'middle', 'first', 'level']), 'Wrynn Anduin');
  });

  it('renders a template instead of joining', () => {
    const values = { first: 'Anduin', last: 'Wrynn' };
    strictEqual(renderLabel(values, ['last', 'first'], '{last}, {first}'), 'Wrynn, Anduin');
    strictEqual(renderLabel({ first: 'Anduin' }, ['last', 'first'], '{last}, {first}'), 'Anduin');
  });

  it('answers an empty string when no field carries text', () => {
    strictEqual(renderLabel({ first: null }, ['first']), '');
    strictEqual(renderLabel({}, []), '');
  });
});
