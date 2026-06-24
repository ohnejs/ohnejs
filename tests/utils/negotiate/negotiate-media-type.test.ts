import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { negotiateMediaType } from '../../../src/utils/index.ts';

describe('negotiateMediaType', () => {
  it('picks the highest-quality acceptable offer', () => {
    strictEqual(
      negotiateMediaType('text/html;q=0.8, application/json;q=0.9', [
        'text/html',
        'application/json',
      ]),
      'application/json',
    );
  });

  it('matches a type/* range', () => {
    strictEqual(negotiateMediaType('text/*', ['application/json', 'text/plain']), 'text/plain');
  });

  it('matches a */* range', () => {
    strictEqual(negotiateMediaType('*/*', ['application/json']), 'application/json');
  });

  it('lets a more specific range override a broader one', () => {
    strictEqual(negotiateMediaType('text/*;q=0.5, text/html;q=0', ['text/html']), undefined);
  });

  it('prefers the more specific range when scoring an offer', () => {
    strictEqual(
      negotiateMediaType('text/*;q=0.5, text/html;q=0.9', ['text/html', 'text/plain']),
      'text/html',
    );
  });

  it('keeps the server order for equally weighted offers', () => {
    strictEqual(negotiateMediaType('*/*', ['text/html', 'application/json']), 'text/html');
  });

  it('returns the original casing of the offer', () => {
    strictEqual(negotiateMediaType('application/json', ['Application/JSON']), 'Application/JSON');
  });

  it('returns undefined when nothing matches', () => {
    strictEqual(negotiateMediaType('image/png', ['text/html']), undefined);
  });

  it('returns undefined for an empty header', () => {
    strictEqual(negotiateMediaType('', ['text/html']), undefined);
  });
});
