import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { routeLimits } from '../../../src/ohne/http/route-limits.ts';
import { defineHandler } from '../../../src/ohne/index.ts';

describe('routeLimits', () => {
  it('parses byte and duration overrides', () => {
    const handler = defineHandler(() => 'ok', {
      maxBodySize: '1kb',
      handlerTimeout: '2s',
      waitUntilTimeout: '500ms',
    });
    deepStrictEqual(routeLimits(handler), {
      maxBodySize: 1024,
      handlerTimeout: 2000,
      waitUntilTimeout: 500,
    });
  });

  it('passes false through as an opt-out', () => {
    const handler = defineHandler(() => 'ok', {
      maxBodySize: false,
      handlerTimeout: false,
      waitUntilTimeout: false,
    });
    deepStrictEqual(routeLimits(handler), {
      maxBodySize: false,
      handlerTimeout: false,
      waitUntilTimeout: false,
    });
  });

  it('leaves an undeclared limit undefined', () => {
    deepStrictEqual(routeLimits(defineHandler(() => 'ok')), {
      maxBodySize: undefined,
      handlerTimeout: undefined,
      waitUntilTimeout: undefined,
    });
  });

  it('memoizes the resolved limits per handler', () => {
    const handler = defineHandler(() => 'ok', { maxBodySize: '1kb' });
    strictEqual(routeLimits(handler), routeLimits(handler));
  });
});
