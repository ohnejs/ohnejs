import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fixture.ts';
import { decorateUpload, decorateUploads } from '../../../src/uploads/uploads/decorate.ts';

describe('decorateUpload', () => {
  it('adds path and url from directory and name', () => {
    const record: Record<string, unknown> = { directory: 'photos', name: 'sunset.jpg', size: 1 };
    decorateUpload(record);
    deepStrictEqual(record, {
      directory: 'photos',
      name: 'sunset.jpg',
      size: 1,
      path: 'photos/sunset.jpg',
      url: '/uploads/photos/sunset.jpg',
    });
  });

  it('leaves a record without both parts untouched', () => {
    const noName: Record<string, unknown> = { directory: 'photos' };
    const noDirectory: Record<string, unknown> = { name: 'sunset.jpg' };
    decorateUpload(noName);
    decorateUpload(noDirectory);
    deepStrictEqual(noName, { directory: 'photos' });
    deepStrictEqual(noDirectory, { name: 'sunset.jpg' });
  });

  it('never sets variants without a service', () => {
    const record: Record<string, unknown> = { directory: '', name: 'a.png', type: 'image/png' };
    decorateUpload(record);
    deepStrictEqual(Object.keys(record).sort(), ['directory', 'name', 'path', 'type', 'url']);
  });
});

describe('decorateUploads', () => {
  it('decorates every record of a read', () => {
    const records: Record<string, unknown>[] = [
      { directory: '', name: 'a.txt' },
      { directory: 'b', name: 'c.txt' },
      { name: 'orphan' },
    ];
    decorateUploads(records);
    deepStrictEqual(
      records.map((record) => record.path),
      ['a.txt', 'b/c.txt', undefined],
    );
  });
});
