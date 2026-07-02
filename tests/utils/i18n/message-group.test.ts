import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { messageGroup } from '../../../src/utils/index.ts';

describe('messageGroup', () => {
  it('returns the first dot-separated segment', () => {
    strictEqual(messageGroup('field.minLength'), 'field');
    strictEqual(messageGroup('api.http.notFound'), 'api');
  });

  it('returns the whole key when there is no dot', () => {
    strictEqual(messageGroup('greeting'), 'greeting');
  });

  it('treats a leading dot as an empty group', () => {
    strictEqual(messageGroup('.hidden'), '');
  });
});
