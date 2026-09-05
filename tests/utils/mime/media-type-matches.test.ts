import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mediaTypeMatches } from '../../../src/utils/index.ts';

describe('mediaTypeMatches', () => {
  it('matches everything with the star', () => {
    strictEqual(mediaTypeMatches('video/mp4', '*'), true);
    strictEqual(mediaTypeMatches('video/mp4', ['*']), true);
    strictEqual(mediaTypeMatches('video/mp4', ['*/*']), true);
  });

  it('matches an exact type, ignoring parameters and case', () => {
    strictEqual(mediaTypeMatches('text/HTML; charset=utf-8', ['text/html']), true);
    strictEqual(mediaTypeMatches('text/plain', ['text/html']), false);
  });

  it('matches a top-level wildcard', () => {
    strictEqual(mediaTypeMatches('image/png', ['image/*']), true);
    strictEqual(mediaTypeMatches('video/mp4', ['image/*']), false);
  });

  it('matches a category name', () => {
    strictEqual(mediaTypeMatches('application/pdf', ['document']), true);
    strictEqual(mediaTypeMatches('image/png', ['image']), true);
    strictEqual(mediaTypeMatches('video/mp4', ['image', 'audio/*']), false);
  });

  it('matches nothing against an empty list', () => {
    strictEqual(mediaTypeMatches('image/png', []), false);
  });
});
