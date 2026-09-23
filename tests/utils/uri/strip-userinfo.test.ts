import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { stripUserinfo } from '../../../src/utils/uri/strip-userinfo.ts';

describe('stripUserinfo', () => {
  it('removes a user and password', () => {
    strictEqual(stripUserinfo('s3://key:secret@photos/a'), 's3://photos/a');
  });

  it('removes a user alone', () => {
    strictEqual(stripUserinfo('https://user@host'), 'https://host');
  });

  it('removes up to the last @ of the authority', () => {
    strictEqual(stripUserinfo('https://u:p@w@host:9000'), 'https://host:9000');
  });

  it('strips a value no URL parser accepts', () => {
    strictEqual(stripUserinfo('s3://key:secret@/x'), 's3:///x');
  });

  it('keeps an @ in the path or query', () => {
    strictEqual(stripUserinfo('https://host/a@b'), 'https://host/a@b');
    strictEqual(stripUserinfo('https://host?to=a@b'), 'https://host?to=a@b');
  });

  it('leaves a URL without userinfo alone', () => {
    strictEqual(stripUserinfo('https://host:9000/a'), 'https://host:9000/a');
  });
});
