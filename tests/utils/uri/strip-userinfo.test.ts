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

  it('strips userinfo without a scheme or without slashes', () => {
    strictEqual(stripUserinfo('key:secret@host:9000'), 'host:9000');
    strictEqual(stripUserinfo('//key:secret@host'), '//host');
    strictEqual(stripUserinfo('s3:key:secret@photos'), 'photos');
  });

  it('cuts up to the last @, so a password holding / or ? goes too', () => {
    strictEqual(stripUserinfo('s3://key:se/cr?et@photos/a'), 's3://photos/a');
    strictEqual(stripUserinfo('s3://b?endpoint=http://u:p@h'), 's3://h');
    strictEqual(stripUserinfo('https://host/a@b'), 'https://b');
  });

  it('leaves a URL without userinfo alone', () => {
    strictEqual(stripUserinfo('https://host:9000/a'), 'https://host:9000/a');
  });
});
