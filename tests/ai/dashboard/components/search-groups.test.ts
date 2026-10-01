import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { searchGroups } from '../../../../src/ai/dashboard/components/search-groups.ts';

const A = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a61';
const B = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a62';

describe('searchGroups', () => {
  it('groups a live answer by collection, then by collection and target, in answer order', () => {
    const via = {
      collection: 'Uploads',
      targets: [{ UUID: B, label: 'cover.png', path: 'image' }],
    };
    deepStrictEqual(
      searchGroups({
        results: [
          { collection: 'People', UUID: A, label: 'Benno' },
          { collection: 'People', UUID: B, label: 'Mira', via },
          { collection: 'Posts', UUID: B, label: 'Launch' },
          { collection: 'People', UUID: A, label: 'Quade', via },
        ],
      }),
      [
        { collection: 'People', hits: [{ UUID: A, label: 'Benno' }], total: 1 },
        {
          collection: 'People',
          via: 'Uploads',
          hits: [
            { UUID: B, label: 'Mira' },
            { UUID: A, label: 'Quade' },
          ],
          total: 2,
        },
        { collection: 'Posts', hits: [{ UUID: B, label: 'Launch' }], total: 1 },
      ],
    );
  });

  it('counts a replayed answer by its kept counts, never by the ids it kept', () => {
    deepStrictEqual(
      searchGroups({
        results: [
          { collection: 'People', UUID: A },
          { collection: 'People', UUID: B, via: { collection: 'Uploads' } },
        ],
        found: { People: 20 },
        related: { People: { Uploads: 14 } },
      }),
      [
        { collection: 'People', hits: [{ UUID: A }], total: 20 },
        { collection: 'People', via: 'Uploads', hits: [{ UUID: B }], total: 14 },
      ],
    );
  });

  it('answers no group for an empty or malformed answer, and skips a hit without ids', () => {
    deepStrictEqual(searchGroups({ results: [] }), []);
    deepStrictEqual(searchGroups(null), []);
    deepStrictEqual(searchGroups({ results: [{ collection: 'People' }, 'x', { UUID: A }] }), []);
  });
});
