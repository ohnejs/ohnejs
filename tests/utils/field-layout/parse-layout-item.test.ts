import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseLayoutItem } from '../../../src/utils/field-layout/parse-layout-item.ts';

describe('parseLayoutItem', () => {
  it('splits the name and the trimmed width', () => {
    deepStrictEqual(parseLayoutItem('title'), { name: 'title' });
    deepStrictEqual(parseLayoutItem('price | 8rem'), { name: 'price', width: '8rem' });
    deepStrictEqual(parseLayoutItem('slug|50%'), { name: 'slug', width: '50%' });
    deepStrictEqual(parseLayoutItem('body |'), { name: 'body' });
  });
});
